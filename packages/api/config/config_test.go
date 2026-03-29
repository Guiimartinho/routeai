package config

import (
	"os"
	"testing"
)

func TestLoadConfigDefaults(t *testing.T) {
	// Clear env vars to test defaults.
	envVars := []string{
		"PORT", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD",
		"DB_NAME", "DB_SSLMODE", "REDIS_HOST", "REDIS_PORT",
		"REDIS_PASSWORD", "REDIS_DB", "MINIO_ENDPOINT",
		"MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_USE_SSL",
		"MINIO_BUCKET", "JWT_SECRET", "JWT_EXPIRY_HOURS",
		"JWT_REFRESH_DAYS", "JWT_ISSUER", "INTELLIGENCE_URL",
		"PARSER_URL", "RATE_LIMIT_FREE", "RATE_LIMIT_PRO",
		"RATE_LIMIT_TEAM",
	}
	for _, key := range envVars {
		os.Unsetenv(key)
	}

	cfg := LoadConfig()

	if cfg.Port != "8080" {
		t.Errorf("expected Port=8080, got %s", cfg.Port)
	}
	if cfg.DB.Host != "localhost" {
		t.Errorf("expected DB.Host=localhost, got %s", cfg.DB.Host)
	}
	if cfg.DB.Port != "5432" {
		t.Errorf("expected DB.Port=5432, got %s", cfg.DB.Port)
	}
	if cfg.DB.User != "routeai" {
		t.Errorf("expected DB.User=routeai, got %s", cfg.DB.User)
	}
	if cfg.DB.SSLMode != "disable" {
		t.Errorf("expected DB.SSLMode=disable, got %s", cfg.DB.SSLMode)
	}
	if cfg.MinIO.Endpoint != "localhost:9000" {
		t.Errorf("expected MinIO.Endpoint=localhost:9000, got %s", cfg.MinIO.Endpoint)
	}
	if cfg.MinIO.UseSSL != false {
		t.Error("expected MinIO.UseSSL=false")
	}
	if cfg.JWT.ExpiryHours != 24 {
		t.Errorf("expected JWT.ExpiryHours=24, got %d", cfg.JWT.ExpiryHours)
	}
	if cfg.JWT.RefreshDays != 7 {
		t.Errorf("expected JWT.RefreshDays=7, got %d", cfg.JWT.RefreshDays)
	}
	if cfg.JWT.Issuer != "routeai" {
		t.Errorf("expected JWT.Issuer=routeai, got %s", cfg.JWT.Issuer)
	}
	if cfg.RateLimits.FreeReviewsPerMonth != 5 {
		t.Errorf("expected FreeReviewsPerMonth=5, got %d", cfg.RateLimits.FreeReviewsPerMonth)
	}
	if cfg.RateLimits.ProReviewsPerMonth != 0 {
		t.Errorf("expected ProReviewsPerMonth=0 (unlimited), got %d", cfg.RateLimits.ProReviewsPerMonth)
	}
}

func TestLoadConfigFromEnv(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("DB_HOST", "db.example.com")
	os.Setenv("DB_PORT", "5433")
	os.Setenv("JWT_EXPIRY_HOURS", "48")
	os.Setenv("MINIO_USE_SSL", "true")
	os.Setenv("RATE_LIMIT_FREE", "10")
	os.Setenv("INTELLIGENCE_URL", "http://ai:8081")
	defer func() {
		os.Unsetenv("PORT")
		os.Unsetenv("DB_HOST")
		os.Unsetenv("DB_PORT")
		os.Unsetenv("JWT_EXPIRY_HOURS")
		os.Unsetenv("MINIO_USE_SSL")
		os.Unsetenv("RATE_LIMIT_FREE")
		os.Unsetenv("INTELLIGENCE_URL")
	}()

	cfg := LoadConfig()

	if cfg.Port != "9090" {
		t.Errorf("expected Port=9090, got %s", cfg.Port)
	}
	if cfg.DB.Host != "db.example.com" {
		t.Errorf("expected DB.Host=db.example.com, got %s", cfg.DB.Host)
	}
	if cfg.DB.Port != "5433" {
		t.Errorf("expected DB.Port=5433, got %s", cfg.DB.Port)
	}
	if cfg.JWT.ExpiryHours != 48 {
		t.Errorf("expected JWT.ExpiryHours=48, got %d", cfg.JWT.ExpiryHours)
	}
	if cfg.MinIO.UseSSL != true {
		t.Error("expected MinIO.UseSSL=true")
	}
	if cfg.RateLimits.FreeReviewsPerMonth != 10 {
		t.Errorf("expected FreeReviewsPerMonth=10, got %d", cfg.RateLimits.FreeReviewsPerMonth)
	}
	if cfg.IntelligenceURL != "http://ai:8081" {
		t.Errorf("expected IntelligenceURL=http://ai:8081, got %s", cfg.IntelligenceURL)
	}
}

func TestDBConfigConnString(t *testing.T) {
	db := DBConfig{
		Host:     "myhost",
		Port:     "5432",
		User:     "myuser",
		Password: "mypass",
		DBName:   "mydb",
		SSLMode:  "require",
	}

	expected := "host=myhost port=5432 user=myuser password=mypass dbname=mydb sslmode=require"
	got := db.ConnString()
	if got != expected {
		t.Errorf("ConnString() = %q, want %q", got, expected)
	}
}

func TestGetEnvInt_InvalidValue(t *testing.T) {
	os.Setenv("TEST_BAD_INT", "not-a-number")
	defer os.Unsetenv("TEST_BAD_INT")

	result := getEnvInt("TEST_BAD_INT", 42)
	if result != 42 {
		t.Errorf("expected fallback 42 for invalid int, got %d", result)
	}
}

func TestGetEnvBool_InvalidValue(t *testing.T) {
	os.Setenv("TEST_BAD_BOOL", "not-a-bool")
	defer os.Unsetenv("TEST_BAD_BOOL")

	result := getEnvBool("TEST_BAD_BOOL", true)
	if result != true {
		t.Errorf("expected fallback true for invalid bool, got %v", result)
	}
}

func TestGetEnv_MissingKey(t *testing.T) {
	os.Unsetenv("NONEXISTENT_KEY")
	result := getEnv("NONEXISTENT_KEY", "default_val")
	if result != "default_val" {
		t.Errorf("expected default_val, got %s", result)
	}
}
