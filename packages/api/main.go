package main

import (
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"

	"routeai/api/config"
	"routeai/api/db"
	"routeai/api/handlers"
	"routeai/api/middleware"
	"routeai/api/storage"
)

// authRoutes defines the methods both real and dev auth handlers expose.
type authRoutes interface {
	Register(c *gin.Context)
	Login(c *gin.Context)
	Refresh(c *gin.Context)
	Me(c *gin.Context)
	GetUsage(c *gin.Context)
}

// projectRoutes defines the methods both real and dev project handlers expose.
type projectRoutes interface {
	CreateProject(c *gin.Context)
	ListProjects(c *gin.Context)
	GetProject(c *gin.Context)
	DeleteProject(c *gin.Context)
}

func main() {
	cfg := config.LoadConfig()

	// -----------------------------------------------------------------------
	// Dev mode detection: skip DB/MinIO if DB_HOST is empty or DB fails.
	// -----------------------------------------------------------------------
	devMode := false
	if os.Getenv("DB_HOST") == "" {
		devMode = true
		log.Println("DEV MODE: DB_HOST not set — running with in-memory auth & projects (no PostgreSQL required)")
	} else {
		if err := db.InitDB(cfg.DB.ConnString()); err != nil {
			devMode = true
			log.Printf("DEV MODE: Database connection failed: %v", err)
			log.Println("DEV MODE: Falling back to in-memory auth & projects")
		}
	}

	// Initialize MinIO storage (non-fatal).
	if err := storage.InitStorage(
		cfg.MinIO.Endpoint,
		cfg.MinIO.AccessKey,
		cfg.MinIO.SecretKey,
		cfg.MinIO.UseSSL,
		cfg.MinIO.Bucket,
	); err != nil {
		log.Printf("WARNING: MinIO connection failed: %v", err)
		log.Println("Server will start but storage operations will fail.")
	}

	// Load KiCad component data into memory.
	kicadIndexPath := getEnv("KICAD_INDEX_PATH", "../../data/component_library/kicad_index.json")
	kicadSymbolsPath := getEnv("KICAD_SYMBOLS_PATH", "../../data/component_library/kicad_symbols.json")
	if err := handlers.LoadKiCadData(kicadIndexPath, kicadSymbolsPath); err != nil {
		log.Printf("WARNING: KiCad data load failed: %v", err)
		log.Println("Component search endpoints will return 503 until data is loaded.")
	}

	// Set Gin mode.
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Global middleware.
	router.Use(gin.Recovery())
	router.Use(middleware.CORSMiddleware())
	router.Use(requestLogger())

	// WebSocket hub.
	hub := handlers.NewHub()
	go hub.Run()

	// -----------------------------------------------------------------------
	// Choose real or dev handlers based on mode.
	// -----------------------------------------------------------------------
	var authHandler authRoutes
	var projectHandler projectRoutes

	if devMode {
		authHandler = handlers.NewDevAuthHandler(cfg)
		projectHandler = handlers.NewDevProjectHandler(cfg)
	} else {
		authHandler = handlers.NewAuthHandler(cfg)
		projectHandler = handlers.NewProjectHandler(cfg)
	}

	reviewHandler := handlers.NewReviewHandler(cfg, hub)
	chatHandler := handlers.NewChatHandler(cfg, hub)
	boardHandler := handlers.NewBoardHandler(cfg)
	componentHandler := handlers.NewComponentHandler()
	workflowHandler := handlers.NewWorkflowHandler(cfg)
	toolsHandler := handlers.NewToolsHandler()
	healthHandler := handlers.NewHealthHandler()

	// -----------------------------------------------------------------------
	// Health (no auth)
	// -----------------------------------------------------------------------
	router.GET("/health", healthHandler.HealthCheck)

	// -----------------------------------------------------------------------
	// Public routes (no auth)
	// -----------------------------------------------------------------------
	v1 := router.Group("/api/v1")
	{
		auth := v1.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
		}

		// Utility endpoints (no auth — dev convenience).
		v1.POST("/config/set-key", handlers.SetAPIKey)
		v1.GET("/info", handlers.GetAPIInfo)

		// Ollama proxy (no auth — local dev convenience).
		ollama := v1.Group("/ollama")
		{
			ollama.GET("/status", healthHandler.OllamaStatus)
			ollama.GET("/models", healthHandler.OllamaModels)
			ollama.GET("/config", healthHandler.OllamaConfig)
			ollama.POST("/pull", healthHandler.OllamaPull)
		}
	}

	// -----------------------------------------------------------------------
	// Public Ollama proxy (no auth — frontend calls /api/ollama/*)
	// -----------------------------------------------------------------------
	pubOllama := router.Group("/api/ollama")
	{
		pubOllama.GET("/status", healthHandler.OllamaStatus)
		pubOllama.GET("/models", healthHandler.OllamaModels)
		pubOllama.GET("/config", healthHandler.OllamaConfig)
		pubOllama.POST("/pull", healthHandler.OllamaPull)
		pubOllama.POST("/chat", healthHandler.OllamaChat)
	}

	// -----------------------------------------------------------------------
	// Public component routes (no auth — frontend calls /api/components/*)
	// -----------------------------------------------------------------------
	pubComponents := router.Group("/api/components")
	{
		pubComponents.GET("/search", componentHandler.SearchComponents)
		pubComponents.GET("/symbol-search", componentHandler.SearchSymbols)
		pubComponents.GET("/symbol/:name", componentHandler.GetSymbol)
		pubComponents.GET("/browse", componentHandler.BrowseComponents)
	}

	// -----------------------------------------------------------------------
	// PCBParts MCP proxy (no auth — optional online component data source)
	// -----------------------------------------------------------------------
	pcbparts := router.Group("/api/pcbparts")
	{
		pcbparts.GET("/search", componentHandler.PCBPartsSearch)
		pcbparts.GET("/alternatives/:lcsc", componentHandler.PCBPartsAlternatives)
		pcbparts.GET("/stock/:lcsc", componentHandler.PCBPartsStock)
		pcbparts.GET("/sensors", componentHandler.PCBPartsSensors)
		pcbparts.GET("/kicad/:id", componentHandler.PCBPartsKiCad)
		pcbparts.GET("/boards", componentHandler.PCBPartsBoards)
		pcbparts.GET("/design-rules", componentHandler.PCBPartsDesignRules)
	}

	// -----------------------------------------------------------------------
	// Protected routes (require JWT)
	// -----------------------------------------------------------------------
	protected := router.Group("/api/v1")
	protected.Use(middleware.AuthMiddleware(cfg.JWT.Secret))
	{
		// Auth routes that need authentication.
		protectedAuth := protected.Group("/auth")
		{
			protectedAuth.POST("/refresh", authHandler.Refresh)
			protectedAuth.GET("/me", authHandler.Me)
		}

		// Project routes.
		projects := protected.Group("/projects")
		{
			projects.POST("", projectHandler.CreateProject)
			projects.GET("", projectHandler.ListProjects)
			projects.GET("/:id", projectHandler.GetProject)
			projects.DELETE("/:id", projectHandler.DeleteProject)
		}

		// Review routes (with rate limiting on POST).
		reviews := protected.Group("/projects/:id")
		reviews.Use(middleware.RateLimitMiddleware(cfg.RateLimits))
		{
			reviews.POST("/review", reviewHandler.StartReview)
			reviews.GET("/review", reviewHandler.GetReview)
			reviews.GET("/review/items", reviewHandler.GetReviewItems)
		}

		// Chat routes.
		chat := protected.Group("/projects/:id")
		{
			chat.POST("/chat", chatHandler.SendMessage)
			chat.GET("/chat", chatHandler.GetHistory)
		}

		// Board data routes.
		board := protected.Group("/projects/:id/board")
		{
			board.GET("", boardHandler.GetBoardData)
			board.GET("/layers", boardHandler.GetLayers)
			board.GET("/nets", boardHandler.GetNets)
		}

		// Component search / browse routes (also available under /api/v1/).
		components := protected.Group("/components")
		{
			components.GET("/search", componentHandler.SearchComponents)
			components.GET("/symbol-search", componentHandler.SearchSymbols)
			components.GET("/symbol/:name", componentHandler.GetSymbol)
			components.GET("/browse", componentHandler.BrowseComponents)
		}

		// Workflow routes (AI placement, review, routing, export, cross-probe).
		workflow := protected.Group("/workflow/:id")
		{
			workflow.POST("/ai-placement", workflowHandler.AIPlacement)
			workflow.POST("/ai-review", workflowHandler.AIReview)
			workflow.POST("/ai-routing", workflowHandler.AIRouting)
			workflow.GET("/status", workflowHandler.GetStatus)
			workflow.GET("/cross-probe", workflowHandler.CrossProbe)
			workflow.POST("/export/:format", workflowHandler.Export)
		}

		// ML proxy routes (suggest, RAG query).
		ml := protected.Group("/ml")
		{
			ml.POST("/suggest", workflowHandler.SuggestComponents)
			ml.POST("/rag-query", workflowHandler.RAGQuery)
		}

		// User usage endpoint.
		protected.GET("/user/usage", authHandler.GetUsage)

		// AI constraint generation (scoped to project).
		protected.POST("/projects/:id/ai/constraints", workflowHandler.GenerateConstraints)

		// DRC analysis & report (scoped to project).
		protected.POST("/projects/:id/analyze", toolsHandler.RunDRC)
		protected.GET("/projects/:id/report", toolsHandler.GetReport)

		// Engineering calculator tools.
		tools := protected.Group("/tools")
		{
			tools.POST("/impedance", toolsHandler.CalculateImpedance)
			tools.POST("/current", toolsHandler.CalculateCurrentCapacity)
		}

		// WebSocket.
		protected.GET("/ws", handlers.HandleWebSocket(hub, cfg.JWT.Secret))
	}

	// -----------------------------------------------------------------------
	// UI / Static file serving
	// -----------------------------------------------------------------------
	// distPath can be overridden via DIST_PATH env; default assumes the
	// binary runs from packages/api/ and the React build is in app/dist/.
	distPath := getEnv("DIST_PATH", filepath.Join("..", "..", "app", "dist"))
	handlers.SetupStaticRoutes(router, distPath)

	addr := ":" + cfg.Port
	log.Printf("RouteAI API Gateway starting on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// requestLogger logs each request with timing information.
func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()

		if query != "" {
			path = path + "?" + query
		}

		log.Printf("[%d] %s %s (%v)", status, c.Request.Method, path, latency)
	}
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return fallback
}
