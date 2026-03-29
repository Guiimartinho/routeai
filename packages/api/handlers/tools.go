package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"routeai/api/middleware"
	"routeai/api/models"
)

// ---------------------------------------------------------------------------
// ToolsHandler — DRC analysis, engineering calculators, and report generation.
// ---------------------------------------------------------------------------

type ToolsHandler struct{}

func NewToolsHandler() *ToolsHandler {
	return &ToolsHandler{}
}

// =========================================================================
// RunDRC — POST /api/v1/projects/:id/analyze
// Proxies to the Python ML service which invokes the DRC engine.
// =========================================================================

type drcRequest struct {
	RuleSet    string   `json:"rule_set,omitempty"`    // e.g. "ipc_class_2", "ipc_class_3"
	Categories []string `json:"categories,omitempty"`  // filter: ["clearance","width","annular_ring"]
	Severity   string   `json:"severity,omitempty"`    // minimum severity: "info","warning","error"
}

func (h *ToolsHandler) RunDRC(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID := c.Param("id")
	if _, err := uuid.Parse(projectID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid project ID"})
		return
	}

	// Read and merge caller body with project ID.
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request body"})
		return
	}

	payload := map[string]interface{}{
		"project_id": projectID,
	}
	var callerData map[string]interface{}
	if len(rawBody) > 0 {
		if err := json.Unmarshal(rawBody, &callerData); err == nil {
			for k, v := range callerData {
				payload[k] = v
			}
		}
	}

	payloadBytes, _ := json.Marshal(payload)
	status, respBody, err := proxyToML("POST", "/ml/analyze", bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("ML DRC proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}

// =========================================================================
// CalculateImpedance — POST /api/v1/tools/impedance
// Pure Go implementation of transmission line impedance calculations.
// References: IPC-2141A, Wadell "Transmission Line Design Handbook"
// =========================================================================

type impedanceRequest struct {
	Topology         string  `json:"topology" binding:"required"`           // "microstrip" or "stripline"
	TraceWidthMM     float64 `json:"trace_width_mm" binding:"required"`    // trace width in mm
	DielectricHeight float64 `json:"dielectric_height_mm" binding:"required"` // dielectric thickness in mm
	Er               float64 `json:"er" binding:"required"`                // relative permittivity
	CopperThickness  float64 `json:"copper_thickness_mm"`                  // copper thickness in mm (default 0.035 = 1oz)
	TraceSpacingMM   float64 `json:"trace_spacing_mm"`                     // differential pair spacing in mm (optional)
}

type impedanceResponse struct {
	Topology         string  `json:"topology"`
	Z0               float64 `json:"z0"`                          // single-ended impedance (ohms)
	ZDiff            float64 `json:"z_diff"`                      // differential impedance (ohms)
	ErEff            float64 `json:"er_eff"`                      // effective dielectric constant
	DelayPsMM        float64 `json:"delay_ps_mm"`                 // propagation delay (ps/mm)
	TraceWidthMM     float64 `json:"trace_width_mm"`
	DielectricHeight float64 `json:"dielectric_height_mm"`
	Er               float64 `json:"er"`
	CopperThickness  float64 `json:"copper_thickness_mm"`
	TraceSpacingMM   float64 `json:"trace_spacing_mm,omitempty"`
}

func (h *ToolsHandler) CalculateImpedance(c *gin.Context) {
	var req impedanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request",
			Details: err.Error(),
		})
		return
	}

	// Default copper thickness: 1 oz = 0.035 mm.
	if req.CopperThickness <= 0 {
		req.CopperThickness = 0.035
	}

	// Validate inputs.
	if req.TraceWidthMM <= 0 || req.DielectricHeight <= 0 || req.Er < 1.0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "trace_width_mm, dielectric_height_mm must be > 0 and er must be >= 1.0",
		})
		return
	}

	var z0, erEff float64

	w := req.TraceWidthMM
	dh := req.DielectricHeight
	t := req.CopperThickness
	er := req.Er

	switch req.Topology {
	case "microstrip":
		z0, erEff = calcMicrostripImpedance(w, dh, t, er)

	case "stripline":
		z0, erEff = calcStriplineImpedance(w, dh, t, er)

	default:
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "unsupported topology",
			Details: "valid topologies: microstrip, stripline",
		})
		return
	}

	// Propagation delay: tpd = sqrt(Er_eff) / c  where c ≈ 299.792 mm/ps
	// Result in ps/mm.
	speedOfLightMMps := 299.792 // mm per ps
	delayPsMM := math.Sqrt(erEff) / speedOfLightMMps

	// Differential impedance.
	// Default spacing for Zdiff calculation if not provided.
	zDiff := 2.0 * z0 // uncoupled default
	if req.TraceSpacingMM > 0 {
		switch req.Topology {
		case "microstrip":
			// Zdiff = 2 * Z0 * (1 - 0.48 * exp(-0.96 * s/h))
			s := req.TraceSpacingMM
			kDiff := 1.0 - 0.48*math.Exp(-0.96*s/dh)
			zDiff = 2.0 * z0 * kDiff
		case "stripline":
			// Zdiff = 2 * Z0 * (1 - 0.347 * exp(-2.9 * s / (2*h)))
			s := req.TraceSpacingMM
			b := 2.0 * dh // total dielectric thickness for symmetric stripline
			kDiff := 1.0 - 0.347*math.Exp(-2.9*s/b)
			zDiff = 2.0 * z0 * kDiff
		}
	}

	resp := impedanceResponse{
		Topology:         req.Topology,
		Z0:               math.Round(z0*1000) / 1000,
		ZDiff:            math.Round(zDiff*1000) / 1000,
		ErEff:            math.Round(erEff*10000) / 10000,
		DelayPsMM:        math.Round(delayPsMM*10000) / 10000,
		TraceWidthMM:     req.TraceWidthMM,
		DielectricHeight: req.DielectricHeight,
		Er:               req.Er,
		CopperThickness:  req.CopperThickness,
		TraceSpacingMM:   req.TraceSpacingMM,
	}

	c.JSON(http.StatusOK, resp)
}

// calcMicrostripImpedance computes Z0 and effective Er for a microstrip line.
// Formula from IPC-2141A / Hammerstad-Jensen (improved):
//
//	We = w + (t/pi) * ln(4e / sqrt((t/h)^2 + (t/(w*pi+1.1*t*pi))^2))
//	for w/h <= 1:  Er_eff = (Er+1)/2 + (Er-1)/2 * (1/sqrt(1+12*h/We) + 0.04*(1-We/h)^2)
//	for w/h >  1:  Er_eff = (Er+1)/2 + (Er-1)/2 * (1/sqrt(1+12*h/We))
//	Z0 = (60/sqrt(Er_eff)) * ln(8*h/We + We/(4*h))   for We/h <= 1
//	Z0 = (120*pi) / (sqrt(Er_eff) * (We/h + 1.393 + 0.667*ln(We/h + 1.444)))  for We/h > 1
func calcMicrostripImpedance(w, h, t, er float64) (z0, erEff float64) {
	// Effective width adjustment for finite copper thickness (Hammerstad).
	we := w
	if t > 0 {
		// Correction factor for trace thickness.
		denom1 := (t / h) * (t / h)
		denom2 := t / (w*math.Pi + 1.1*t*math.Pi)
		denom2 = denom2 * denom2
		we = w + (t/math.Pi)*math.Log(4*math.E/math.Sqrt(denom1+denom2))
	}

	ratio := we / h

	// Effective dielectric constant.
	if ratio <= 1.0 {
		erEff = (er+1.0)/2.0 + (er-1.0)/2.0*(1.0/math.Sqrt(1.0+12.0*h/we)+0.04*(1.0-ratio)*(1.0-ratio))
	} else {
		erEff = (er+1.0)/2.0 + (er-1.0)/2.0*(1.0/math.Sqrt(1.0+12.0*h/we))
	}

	// Characteristic impedance.
	if ratio <= 1.0 {
		z0 = (60.0 / math.Sqrt(erEff)) * math.Log(8.0*h/we+we/(4.0*h))
	} else {
		z0 = (120.0 * math.Pi) / (math.Sqrt(erEff) * (ratio + 1.393 + 0.667*math.Log(ratio+1.444)))
	}

	return z0, erEff
}

// calcStriplineImpedance computes Z0 and effective Er for a symmetric stripline.
// For symmetric stripline, Er_eff ≈ Er (dielectric fully surrounds the trace).
// Formula from IPC-2141A:
//
//	We = w + (t/pi) * (1 + ln(4*pi*b / t))   where b = 2*h (ground-to-ground distance)
//	Z0 = (60 / sqrt(Er)) * ln(4*b / (pi*d_e))
//	where d_e = 0.67 * pi * We * (0.8 + t/We)  is the equivalent round conductor diameter.
//
// Alternative (Cohn's formula for thin strip):
//
//	Z0 = (60/sqrt(Er)) * ln(2*b / (pi * We))  for narrow strips
func calcStriplineImpedance(w, h, t, er float64) (z0, erEff float64) {
	erEff = er // Stripline is embedded in dielectric.

	b := 2.0 * h // Ground-to-ground spacing for symmetric stripline.

	// Effective width for finite thickness.
	we := w
	if t > 0 && t < b {
		// Wheeler's correction for thickness.
		m := 2.0 * b / t // helper ratio
		if m > 1 {
			we = w + (t/math.Pi)*(1.0+math.Log(4.0*math.Pi*b/t))
		}
	}

	// Ensure strip fits between ground planes.
	if we >= b {
		// Fallback to simple formula for very wide strips.
		z0 = (377.0 / (4.0 * math.Sqrt(er))) * (b / we)
		return z0, erEff
	}

	// Cohn's formula for symmetric stripline (good for w/b < 0.35).
	ratio := we / b
	if ratio < 0.35 {
		z0 = (60.0 / math.Sqrt(er)) * math.Log(2.0*b/(math.Pi*we))
	} else {
		// More accurate: use equivalent round conductor approach.
		cf := (2.0 / (1.0 - ratio)) * math.Log(1.0/(1.0-ratio)) + (ratio-1.0)*math.Log(1.0/(ratio*ratio)-1.0)
		we_b := ratio + (1.0/math.Pi)*cf
		// Wadell's general stripline formula using effective width/spacing ratio.
		z0 = (30.0 * math.Pi / math.Sqrt(er)) / (we_b + 0.441)
	}

	return z0, erEff
}

// =========================================================================
// CalculateCurrentCapacity — POST /api/v1/tools/current
// Pure Go implementation of IPC-2152 trace current capacity.
// =========================================================================

type currentRequest struct {
	TraceWidthMM float64 `json:"trace_width_mm" binding:"required"` // trace width in mm
	CopperOz     float64 `json:"copper_oz" binding:"required"`      // copper weight in oz/ft² (1oz = 35µm)
	TempRiseC    float64 `json:"temp_rise_c" binding:"required"`    // allowable temperature rise in °C
}

type currentResponse struct {
	MaxCurrentExternal float64 `json:"max_current_external"` // amps, external (outer) layer
	MaxCurrentInternal float64 `json:"max_current_internal"` // amps, internal layer
	TraceWidthMM       float64 `json:"trace_width_mm"`
	CopperOz           float64 `json:"copper_oz"`
	CopperThicknessMM  float64 `json:"copper_thickness_mm"`
	TempRiseC          float64 `json:"temp_rise_c"`
	CrossSectionMM2    float64 `json:"cross_section_mm2"`
}

func (h *ToolsHandler) CalculateCurrentCapacity(c *gin.Context) {
	var req currentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error:   "invalid request",
			Details: err.Error(),
		})
		return
	}

	// Validate.
	if req.TraceWidthMM <= 0 || req.CopperOz <= 0 || req.TempRiseC <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "trace_width_mm, copper_oz, and temp_rise_c must all be > 0",
		})
		return
	}

	// Convert copper weight to thickness.
	// 1 oz/ft² copper = 0.035 mm = 35 µm = 1.378 mils.
	copperThicknessMM := req.CopperOz * 0.035

	// Cross-sectional area in mm².
	crossSectionMM2 := req.TraceWidthMM * copperThicknessMM

	// Convert to mils² for IPC-2152 formula (1 mm = 39.3701 mils).
	traceWidthMils := req.TraceWidthMM * 39.3701
	copperThicknessMils := copperThicknessMM * 39.3701
	crossSectionMils2 := traceWidthMils * copperThicknessMils

	// IPC-2152 formula: I = k * dT^0.44 * A^0.725
	// where:
	//   I  = current in amps
	//   k  = constant (differs for external vs internal layers)
	//   dT = temperature rise in °C
	//   A  = cross-sectional area in mils²

	// External (outer) layer: k = 0.048
	kExternal := 0.048
	maxCurrentExternal := kExternal * math.Pow(req.TempRiseC, 0.44) * math.Pow(crossSectionMils2, 0.725)

	// Internal layer: k = 0.024 (roughly half the external capacity due to
	// reduced convection — heat is trapped between laminate layers).
	kInternal := 0.024
	maxCurrentInternal := kInternal * math.Pow(req.TempRiseC, 0.44) * math.Pow(crossSectionMils2, 0.725)

	resp := currentResponse{
		MaxCurrentExternal: math.Round(maxCurrentExternal*1000) / 1000,
		MaxCurrentInternal: math.Round(maxCurrentInternal*1000) / 1000,
		TraceWidthMM:       req.TraceWidthMM,
		CopperOz:           req.CopperOz,
		CopperThicknessMM:  copperThicknessMM,
		TempRiseC:          req.TempRiseC,
		CrossSectionMM2:    math.Round(crossSectionMM2*10000) / 10000,
	}

	c.JSON(http.StatusOK, resp)
}

// =========================================================================
// GetReport — GET /api/v1/projects/:id/report
// Proxies to the ML service for AI commentary combined with DRC data.
// =========================================================================

func (h *ToolsHandler) GetReport(c *gin.Context) {
	_, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse{Error: "authentication required"})
		return
	}

	projectID := c.Param("id")
	if _, err := uuid.Parse(projectID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid project ID"})
		return
	}

	// Build query parameters for the ML service.
	mlPath := fmt.Sprintf("/ml/report/%s", projectID)

	// Forward optional query params.
	q := c.Request.URL.Query()
	if format := q.Get("format"); format != "" {
		mlPath += "?format=" + format
	}

	status, respBody, err := proxyToML("GET", mlPath, nil)
	if err != nil {
		log.Printf("ML report proxy error: %v", err)
		c.JSON(http.StatusBadGateway, models.ErrorResponse{
			Error:   "ML service unavailable",
			Details: err.Error(),
		})
		return
	}

	c.Data(status, "application/json", respBody)
}
