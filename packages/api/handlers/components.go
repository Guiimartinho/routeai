package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// KiCad component data types (matches kicad_index.json / kicad_symbols.json)
// ---------------------------------------------------------------------------

// ComponentIndex is a single entry from kicad_index.json.
type ComponentIndex struct {
	MPN          string `json:"mpn"`
	Manufacturer string `json:"manufacturer"`
	Description  string `json:"description"`
	Category     string `json:"category"`
	Package      string `json:"package"`
	Source       string `json:"source"`
	Keywords     string `json:"keywords"`
	DatasheetURL string `json:"datasheet_url"`
	Library      string `json:"library"`
	HasSymbol    bool   `json:"has_symbol"`
	HasFootprint bool   `json:"has_footprint"`
}

// SymbolPin represents a single pin in a KiCad symbol.
type SymbolPin struct {
	Name      string  `json:"name"`
	Number    string  `json:"number"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Type      string  `json:"type"`
	Direction string  `json:"direction"`
	Length    float64 `json:"length"`
}

// SymbolBody is the bounding rectangle of a KiCad symbol.
type SymbolBody struct {
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

// ComponentSymbol is a single entry from kicad_symbols.json.
type ComponentSymbol struct {
	Name      string      `json:"name"`
	RefPrefix string      `json:"refPrefix"`
	Library   string      `json:"library"`
	PinCount  int         `json:"pinCount"`
	Pins      []SymbolPin `json:"pins"`
	Body      SymbolBody  `json:"body"`
}

// ---------------------------------------------------------------------------
// In-memory component store (loaded once at startup)
// ---------------------------------------------------------------------------

// ComponentStore holds all KiCad component data in memory for fast search.
type ComponentStore struct {
	mu      sync.RWMutex
	index   []ComponentIndex            // full list from kicad_index.json
	symbols map[string]*ComponentSymbol // name -> symbol from kicad_symbols.json
	loaded  bool
}

var globalComponentStore = &ComponentStore{
	symbols: make(map[string]*ComponentSymbol),
}

// LoadKiCadData reads both JSON files into memory.  Call once at startup.
func LoadKiCadData(indexPath, symbolsPath string) error {
	store := globalComponentStore
	store.mu.Lock()
	defer store.mu.Unlock()

	// --- Load index ---
	idxData, err := os.ReadFile(indexPath)
	if err != nil {
		return err
	}
	var idx []ComponentIndex
	if err := json.Unmarshal(idxData, &idx); err != nil {
		return err
	}
	store.index = idx
	log.Printf("Loaded %d components from kicad_index.json", len(idx))

	// --- Load symbols ---
	symData, err := os.ReadFile(symbolsPath)
	if err != nil {
		return err
	}
	var syms []ComponentSymbol
	if err := json.Unmarshal(symData, &syms); err != nil {
		return err
	}
	store.symbols = make(map[string]*ComponentSymbol, len(syms))
	for i := range syms {
		store.symbols[strings.ToLower(syms[i].Name)] = &syms[i]
	}
	log.Printf("Loaded %d symbols from kicad_symbols.json", len(syms))

	store.loaded = true
	return nil
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// ComponentHandler serves component search / browse / symbol endpoints.
type ComponentHandler struct{}

// NewComponentHandler creates a new handler (data is in the global store).
func NewComponentHandler() *ComponentHandler {
	return &ComponentHandler{}
}

// SearchComponents handles GET /api/v1/components/search?q=STM32&limit=40
func (h *ComponentHandler) SearchComponents(c *gin.Context) {
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query parameter 'q' is required"})
		return
	}

	limit := 40
	if lStr := c.Query("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 200 {
			limit = l
		}
	}

	offset := 0
	if oStr := c.Query("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	store := globalComponentStore
	store.mu.RLock()
	defer store.mu.RUnlock()

	if !store.loaded {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "component data not loaded"})
		return
	}

	terms := strings.Fields(q)

	// Collect matches (simple multi-term substring search).
	type scored struct {
		comp  ComponentIndex
		score int
	}
	var matches []scored

	for _, comp := range store.index {
		haystack := strings.ToLower(comp.MPN + " " + comp.Description + " " + comp.Keywords + " " + comp.Category + " " + comp.Library + " " + comp.Manufacturer)
		totalScore := 0
		allMatch := true
		for _, term := range terms {
			if idx := strings.Index(haystack, term); idx >= 0 {
				// Exact MPN match gets a big boost; partial MPN match gets
			// a medium boost; otherwise just +1 for field presence.
				if strings.EqualFold(comp.MPN, q) {
					totalScore += 100
				} else if strings.Contains(strings.ToLower(comp.MPN), term) {
					totalScore += 10
				} else {
					totalScore += 1
				}
			} else {
				allMatch = false
				break
			}
		}
		if allMatch && totalScore > 0 {
			matches = append(matches, scored{comp: comp, score: totalScore})
		}
	}

	// Sort by score descending (simple insertion sort is fine for search results).
	for i := 1; i < len(matches); i++ {
		for j := i; j > 0 && matches[j].score > matches[j-1].score; j-- {
			matches[j], matches[j-1] = matches[j-1], matches[j]
		}
	}

	total := len(matches)

	// Apply offset.
	if offset >= len(matches) {
		matches = nil
	} else {
		matches = matches[offset:]
	}

	// Apply limit.
	if len(matches) > limit {
		matches = matches[:limit]
	}

	results := make([]ComponentIndex, len(matches))
	for i, m := range matches {
		results[i] = m.comp
	}

	c.JSON(http.StatusOK, gin.H{
		"results": results,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// GetSymbol handles GET /api/v1/components/symbol/:name
func (h *ComponentHandler) GetSymbol(c *gin.Context) {
	name := strings.ToLower(strings.TrimSpace(c.Param("name")))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "symbol name is required"})
		return
	}

	store := globalComponentStore
	store.mu.RLock()
	defer store.mu.RUnlock()

	if !store.loaded {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "component data not loaded"})
		return
	}

	sym, ok := store.symbols[name]
	if !ok {
		// Fallback 1: case-insensitive exact match across all keys.
		for key, s := range store.symbols {
			if strings.EqualFold(key, name) {
				sym = s
				ok = true
				break
			}
		}
	}
	if !ok {
		// Fallback 2: prefix match — find any symbol whose name starts with the query.
		// E.g., query "stm32f103c8" matches symbol "stm32f103c8tx".
		// Pick the shortest matching name (most specific match).
		bestLen := -1
		for key, s := range store.symbols {
			if strings.HasPrefix(key, name) {
				if bestLen < 0 || len(key) < bestLen {
					sym = s
					ok = true
					bestLen = len(key)
				}
			}
		}
	}
	if !ok {
		// Fallback 3: reverse prefix — find any symbol whose name is a prefix of the query.
		// E.g., query "stm32f103c8t6" matches symbol "stm32f103c8tx" via common prefix.
		// Guard: the symbol name must be at least 60% of the query length to prevent
		// false positives like symbol "L" (1 char) matching query "LM358" (5 chars).
		bestLen := -1
		minSymLen := int(float64(len(name)) * 0.6)
		if minSymLen < 2 {
			minSymLen = 2
		}
		for key, s := range store.symbols {
			if len(key) >= minSymLen && strings.HasPrefix(name, key) {
				if bestLen < 0 || len(key) > bestLen {
					sym = s
					ok = true
					bestLen = len(key)
				}
			}
		}
	}
	if !ok {
		// Fallback 4: longest common prefix match.
		// E.g., query "stm32f103c8t6" and symbol "stm32f103c8tx" share prefix "stm32f103c8t".
		// Require common prefix to be at least max(6, 70% of query length) to avoid
		// false matches on short queries.
		minPrefixLen := int(float64(len(name)) * 0.7)
		if minPrefixLen < 6 {
			minPrefixLen = 6
		}
		bestPrefixLen := 0
		for key, s := range store.symbols {
			// Find common prefix length
			shorter := len(name)
			if len(key) < shorter {
				shorter = len(key)
			}
			commonLen := 0
			for i := 0; i < shorter; i++ {
				if name[i] == key[i] {
					commonLen++
				} else {
					break
				}
			}
			if commonLen >= minPrefixLen && commonLen > bestPrefixLen {
				bestPrefixLen = commonLen
				sym = s
				ok = true
			} else if commonLen == bestPrefixLen && commonLen >= minPrefixLen && ok {
				// Tie-break: prefer shorter symbol name (more specific)
				if len(key) < len(sym.Name) {
					sym = s
				}
			}
		}
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "symbol not found", "name": name})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"found":  true,
		"symbol": sym,
	})
}

// SearchSymbols handles GET /api/v1/components/symbol-search?q=STM32&limit=20
// Returns lightweight results (name, library, refPrefix, pinCount) without full pin arrays.
func (h *ComponentHandler) SearchSymbols(c *gin.Context) {
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query parameter 'q' is required"})
		return
	}

	limit := 20
	if lStr := c.Query("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 200 {
			limit = l
		}
	}

	store := globalComponentStore
	store.mu.RLock()
	defer store.mu.RUnlock()

	if !store.loaded {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "component data not loaded"})
		return
	}

	type symbolResult struct {
		Name      string `json:"name"`
		Library   string `json:"library"`
		RefPrefix string `json:"refPrefix"`
		PinCount  int    `json:"pinCount"`
	}

	var results []symbolResult
	for _, sym := range store.symbols {
		haystack := strings.ToLower(sym.Name + " " + sym.Library + " " + sym.RefPrefix)
		if strings.Contains(haystack, q) {
			results = append(results, symbolResult{
				Name:      sym.Name,
				Library:   sym.Library,
				RefPrefix: sym.RefPrefix,
				PinCount:  sym.PinCount,
			})
			if len(results) >= limit {
				break
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results": results,
		"total":   len(results),
		"limit":   limit,
	})
}

// BrowseComponents handles GET /api/v1/components/browse?category=mcu&limit=40
func (h *ComponentHandler) BrowseComponents(c *gin.Context) {
	category := strings.ToLower(strings.TrimSpace(c.Query("category")))
	library := strings.ToLower(strings.TrimSpace(c.Query("library")))

	limit := 40
	if lStr := c.Query("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 200 {
			limit = l
		}
	}

	offset := 0
	if oStr := c.Query("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	store := globalComponentStore
	store.mu.RLock()
	defer store.mu.RUnlock()

	if !store.loaded {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "component data not loaded"})
		return
	}

	// If neither filter is set, return available categories.
	if category == "" && library == "" {
		cats := map[string]int{}
		libs := map[string]int{}
		for _, comp := range store.index {
			if comp.Category != "" {
				cats[comp.Category]++
			}
			if comp.Library != "" {
				libs[comp.Library]++
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"categories": cats,
			"libraries":  libs,
			"total":      len(store.index),
		})
		return
	}

	var results []ComponentIndex
	for _, comp := range store.index {
		match := true
		if category != "" && !strings.EqualFold(comp.Category, category) {
			match = false
		}
		if library != "" && !strings.EqualFold(comp.Library, library) {
			match = false
		}
		if match {
			results = append(results, comp)
		}
	}

	total := len(results)

	if offset >= len(results) {
		results = nil
	} else {
		results = results[offset:]
	}
	if len(results) > limit {
		results = results[:limit]
	}

	c.JSON(http.StatusOK, gin.H{
		"results": results,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}
