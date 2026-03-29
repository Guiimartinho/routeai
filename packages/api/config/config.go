package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port            string
	DB              DBConfig
	Redis           RedisConfig
	MinIO           MinIOConfig
	JWT             JWTConfig
	IntelligenceURL string
	ParserURL       string
	MLServiceURL    string
	OllamaBaseURL   string
	RateLimits      RateLimitConfig
}

type DBConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

func (d DBConfig) ConnString() string {
	return "host=" + d.Host +
		" port=" + d.Port +
		" user=" + d.User +
		" password=" + d.Password +
		" dbname=" + d.DBName +
		" sslmode=" + d.SSLMode
}

type RedisConfig struct {
	Host     string
	Port     string
	Password string
	DB       int
}

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	UseSSL    bool
	Bucket    string
}

type JWTConfig struct {
	Secret          string
	ExpiryHours     int
	RefreshDays     int
	Issuer          string
}

type RateLimitConfig struct {
	FreeReviewsPerMonth int
	ProReviewsPerMonth  int
	TeamReviewsPerMonth int
}

func LoadConfig() *Config {
	return &Config{
		Port: getEnv("PORT", "8080"),
		DB: DBConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnv("DB_PORT", "5432"),
			User:     getEnv("DB_USER", "routeai"),
			Password: getEnv("DB_PASSWORD", "routeai"),
			DBName:   getEnv("DB_NAME", "routeai"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 0),
		},
		MinIO: MinIOConfig{
			Endpoint:  getEnv("MINIO_ENDPOINT", "localhost:9000"),
			AccessKey: getEnv("MINIO_ACCESS_KEY", "minioadmin"),
			SecretKey: getEnv("MINIO_SECRET_KEY", "minioadmin"),
			UseSSL:    getEnvBool("MINIO_USE_SSL", false),
			Bucket:    getEnv("MINIO_BUCKET", "routeai-projects"),
		},
		JWT: JWTConfig{
			Secret:      getEnv("JWT_SECRET", "change-me-in-production"),
			ExpiryHours: getEnvInt("JWT_EXPIRY_HOURS", 24),
			RefreshDays: getEnvInt("JWT_REFRESH_DAYS", 7),
			Issuer:      getEnv("JWT_ISSUER", "routeai"),
		},
		IntelligenceURL: getEnv("INTELLIGENCE_URL", "http://localhost:8081"),
		ParserURL:       getEnv("PARSER_URL", "http://localhost:8082"),
		MLServiceURL:    getEnv("ML_SERVICE_URL", "http://localhost:8001"),
		OllamaBaseURL:   getEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
		RateLimits: RateLimitConfig{
			FreeReviewsPerMonth: getEnvInt("RATE_LIMIT_FREE", 5),
			ProReviewsPerMonth:  getEnvInt("RATE_LIMIT_PRO", 0),
			TeamReviewsPerMonth: getEnvInt("RATE_LIMIT_TEAM", 0),
		},
	}
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val, ok := os.LookupEnv(key); ok {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if val, ok := os.LookupEnv(key); ok {
		if b, err := strconv.ParseBool(val); err == nil {
			return b
		}
	}
	return fallback
}
