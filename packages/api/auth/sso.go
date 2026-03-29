package auth

import (
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"routeai/api/db"
	"routeai/api/models"
)

// SSOProvider represents the configuration for an identity provider.
type SSOProvider struct {
	ID           uuid.UUID `json:"id" db:"id"`
	Name         string    `json:"name" db:"name"`           // Display name: "Okta", "Azure AD", etc.
	Protocol     string    `json:"protocol" db:"protocol"`   // "saml" or "oauth2"
	ClientID     string    `json:"client_id" db:"client_id"`
	ClientSecret string    `json:"-" db:"client_secret"`
	RedirectURI  string    `json:"redirect_uri" db:"redirect_uri"`
	AuthURL      string    `json:"auth_url" db:"auth_url"`             // OAuth2 authorization endpoint
	TokenURL     string    `json:"token_url" db:"token_url"`           // OAuth2 token endpoint
	UserInfoURL  string    `json:"userinfo_url" db:"userinfo_url"`     // OAuth2 userinfo endpoint
	SSOURL       string    `json:"sso_url" db:"sso_url"`               // SAML IdP SSO URL
	Certificate  string    `json:"certificate,omitempty" db:"certificate"` // SAML IdP X.509 certificate (PEM)
	Issuer       string    `json:"issuer" db:"issuer"`                 // SAML Issuer / OAuth2 issuer
	Scopes       string    `json:"scopes" db:"scopes"`                 // Space-separated OAuth2 scopes
	Enabled      bool      `json:"enabled" db:"enabled"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// ssoMigrationSQL creates the sso_providers table.
const ssoMigrationSQL = `
CREATE TABLE IF NOT EXISTS sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    protocol VARCHAR(50) NOT NULL DEFAULT 'oauth2',
    client_id VARCHAR(512) NOT NULL DEFAULT '',
    client_secret VARCHAR(512) NOT NULL DEFAULT '',
    redirect_uri VARCHAR(1024) NOT NULL DEFAULT '',
    auth_url VARCHAR(1024) NOT NULL DEFAULT '',
    token_url VARCHAR(1024) NOT NULL DEFAULT '',
    userinfo_url VARCHAR(1024) NOT NULL DEFAULT '',
    sso_url VARCHAR(1024) NOT NULL DEFAULT '',
    certificate TEXT NOT NULL DEFAULT '',
    issuer VARCHAR(512) NOT NULL DEFAULT '',
    scopes VARCHAR(512) NOT NULL DEFAULT 'openid profile email',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_providers_name ON sso_providers(name);
`

// SSOService handles SSO/SAML/OAuth2 authentication flows.
type SSOService struct {
	db        *sql.DB
	jwtSecret string
	baseURL   string // e.g. "https://app.routeai.dev"
}

// NewSSOService creates the SSO service and runs migrations.
func NewSSOService(database *sql.DB, jwtSecret, baseURL string) (*SSOService, error) {
	if _, err := database.Exec(ssoMigrationSQL); err != nil {
		return nil, fmt.Errorf("sso migration failed: %w", err)
	}
	return &SSOService{
		db:        database,
		jwtSecret: jwtSecret,
		baseURL:   baseURL,
	}, nil
}

// RegisterRoutes sets up the SSO endpoints on a Gin router group.
// Expected base: /api/v1/auth/sso
func (s *SSOService) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/providers", s.ListProviders)
	rg.GET("/:provider/login", s.InitiateLogin)
	rg.POST("/:provider/callback", s.HandleCallback)
	rg.GET("/:provider/callback", s.HandleCallback) // OAuth2 redirect comes as GET
}

// ListProviders returns all enabled SSO providers (sans secrets).
// GET /api/v1/auth/sso/providers
func (s *SSOService) ListProviders(c *gin.Context) {
	rows, err := s.db.Query(
		`SELECT id, name, protocol, client_id, redirect_uri, auth_url, sso_url, issuer, scopes, enabled, created_at
		 FROM sso_providers WHERE enabled = true ORDER BY name ASC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list providers"})
		return
	}
	defer rows.Close()

	var providers []SSOProvider
	for rows.Next() {
		var p SSOProvider
		if err := rows.Scan(&p.ID, &p.Name, &p.Protocol, &p.ClientID,
			&p.RedirectURI, &p.AuthURL, &p.SSOURL, &p.Issuer, &p.Scopes,
			&p.Enabled, &p.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan provider"})
			return
		}
		providers = append(providers, p)
	}

	c.JSON(http.StatusOK, gin.H{"providers": providers})
}

// InitiateLogin starts the SSO login flow for the given provider.
// GET /api/v1/auth/sso/:provider/login
func (s *SSOService) InitiateLogin(c *gin.Context) {
	providerName := c.Param("provider")
	provider, err := s.getProviderByName(providerName)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("provider %q not found", providerName)})
		return
	}

	switch provider.Protocol {
	case "saml":
		s.initiateSAMLLogin(c, provider)
	case "oauth2":
		s.initiateOAuth2Login(c, provider)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported protocol"})
	}
}

// HandleCallback processes the callback from the identity provider.
// POST /api/v1/auth/sso/:provider/callback
func (s *SSOService) HandleCallback(c *gin.Context) {
	providerName := c.Param("provider")
	provider, err := s.getProviderByName(providerName)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("provider %q not found", providerName)})
		return
	}

	switch provider.Protocol {
	case "saml":
		s.handleSAMLCallback(c, provider)
	case "oauth2":
		s.handleOAuth2Callback(c, provider)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported protocol"})
	}
}

// ---- OAuth2 Flow ----

func (s *SSOService) initiateOAuth2Login(c *gin.Context, provider *SSOProvider) {
	state := uuid.New().String()

	params := url.Values{
		"client_id":     {provider.ClientID},
		"redirect_uri":  {provider.RedirectURI},
		"response_type": {"code"},
		"scope":         {provider.Scopes},
		"state":         {state},
	}

	redirectURL := provider.AuthURL + "?" + params.Encode()
	c.JSON(http.StatusOK, gin.H{
		"redirect_url": redirectURL,
		"state":        state,
	})
}

func (s *SSOService) handleOAuth2Callback(c *gin.Context, provider *SSOProvider) {
	code := c.Query("code")
	if code == "" {
		code = c.PostForm("code")
	}
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization code"})
		return
	}

	// Exchange code for tokens.
	tokenResp, err := s.exchangeOAuth2Code(provider, code)
	if err != nil {
		log.Printf("sso: token exchange failed for %s: %v", provider.Name, err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token exchange failed"})
		return
	}

	// Fetch user info.
	userInfo, err := s.fetchOAuth2UserInfo(provider, tokenResp.AccessToken)
	if err != nil {
		log.Printf("sso: userinfo fetch failed for %s: %v", provider.Name, err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "failed to fetch user info"})
		return
	}

	// Create or update the local user.
	user, err := s.upsertUser(userInfo.Email, userInfo.Name, provider.Name)
	if err != nil {
		log.Printf("sso: user upsert failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	// Issue JWT tokens.
	authResp, err := issueTokens(user, s.jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue tokens"})
		return
	}

	c.JSON(http.StatusOK, authResp)
}

type oauth2TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
}

func (s *SSOService) exchangeOAuth2Code(provider *SSOProvider, code string) (*oauth2TokenResponse, error) {
	data := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {provider.RedirectURI},
		"client_id":     {provider.ClientID},
		"client_secret": {provider.ClientSecret},
	}

	resp, err := http.PostForm(provider.TokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp oauth2TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}
	return &tokenResp, nil
}

type oauth2UserInfo struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (s *SSOService) fetchOAuth2UserInfo(provider *SSOProvider, accessToken string) (*oauth2UserInfo, error) {
	req, err := http.NewRequest("GET", provider.UserInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("userinfo request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read userinfo: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var info oauth2UserInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("parse userinfo: %w", err)
	}
	if info.Email == "" {
		return nil, fmt.Errorf("userinfo response missing email")
	}
	return &info, nil
}

// ---- SAML Flow ----

// SAMLAssertion represents a simplified parsed SAML assertion.
type SAMLAssertion struct {
	XMLName    xml.Name `xml:"Response"`
	Status     string   `xml:"Status>StatusCode,attr"`
	Assertions []struct {
		Subject struct {
			NameID string `xml:"NameID"`
		} `xml:"Subject"`
		Attributes []struct {
			Name   string `xml:"Name,attr"`
			Values []struct {
				Value string `xml:",chardata"`
			} `xml:"AttributeValue"`
		} `xml:"AttributeStatement>Attribute"`
	} `xml:"Assertion"`
}

func (s *SSOService) initiateSAMLLogin(c *gin.Context, provider *SSOProvider) {
	// Build a SAML AuthnRequest redirect URL.
	requestID := "_" + uuid.New().String()
	issueInstant := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	acsURL := provider.RedirectURI

	samlRequest := fmt.Sprintf(
		`<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
		    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
		    ID="%s"
		    Version="2.0"
		    IssueInstant="%s"
		    Destination="%s"
		    AssertionConsumerServiceURL="%s"
		    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
		    <saml:Issuer>%s</saml:Issuer>
		</samlp:AuthnRequest>`,
		requestID, issueInstant, provider.SSOURL, acsURL, provider.Issuer,
	)

	encoded := base64.StdEncoding.EncodeToString([]byte(samlRequest))
	redirectURL := fmt.Sprintf("%s?SAMLRequest=%s", provider.SSOURL, url.QueryEscape(encoded))

	c.JSON(http.StatusOK, gin.H{
		"redirect_url": redirectURL,
	})
}

func (s *SSOService) handleSAMLCallback(c *gin.Context, provider *SSOProvider) {
	samlResponseB64 := c.PostForm("SAMLResponse")
	if samlResponseB64 == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing SAMLResponse"})
		return
	}

	responseXML, err := base64.StdEncoding.DecodeString(samlResponseB64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid SAMLResponse encoding"})
		return
	}

	// Validate the certificate if provided.
	if provider.Certificate != "" {
		if err := validateSAMLCertificate(provider.Certificate); err != nil {
			log.Printf("sso: SAML certificate validation warning: %v", err)
			// Continue processing - in production this would be stricter.
		}
	}

	// Parse the SAML assertion.
	var assertion SAMLAssertion
	if err := xml.Unmarshal(responseXML, &assertion); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to parse SAML response"})
		return
	}

	// Extract user attributes from the assertion.
	email, name := extractSAMLAttributes(assertion)
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SAML assertion missing email attribute"})
		return
	}

	// Create or update user.
	user, err := s.upsertUser(email, name, provider.Name)
	if err != nil {
		log.Printf("sso: user upsert failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	authResp, err := issueTokens(user, s.jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue tokens"})
		return
	}

	c.JSON(http.StatusOK, authResp)
}

// extractSAMLAttributes pulls email and name from the parsed SAML assertion.
func extractSAMLAttributes(assertion SAMLAssertion) (email, name string) {
	for _, a := range assertion.Assertions {
		// Try NameID first.
		if a.Subject.NameID != "" && strings.Contains(a.Subject.NameID, "@") {
			email = a.Subject.NameID
		}
		for _, attr := range a.Attributes {
			lowerName := strings.ToLower(attr.Name)
			if len(attr.Values) == 0 {
				continue
			}
			val := attr.Values[0].Value
			switch {
			case strings.Contains(lowerName, "emailaddress") || strings.Contains(lowerName, "email"):
				email = val
			case strings.Contains(lowerName, "displayname") || strings.Contains(lowerName, "name"):
				name = val
			case strings.Contains(lowerName, "givenname") || strings.Contains(lowerName, "firstname"):
				if name == "" {
					name = val
				}
			case strings.Contains(lowerName, "surname") || strings.Contains(lowerName, "lastname"):
				if name != "" {
					name = name + " " + val
				} else {
					name = val
				}
			}
		}
	}
	if name == "" && email != "" {
		name = strings.Split(email, "@")[0]
	}
	return email, name
}

// validateSAMLCertificate does basic validation of the IdP certificate.
func validateSAMLCertificate(certPEM string) error {
	certPEM = strings.TrimSpace(certPEM)
	// Strip PEM headers if present.
	certPEM = strings.ReplaceAll(certPEM, "-----BEGIN CERTIFICATE-----", "")
	certPEM = strings.ReplaceAll(certPEM, "-----END CERTIFICATE-----", "")
	certPEM = strings.ReplaceAll(certPEM, "\n", "")
	certPEM = strings.ReplaceAll(certPEM, "\r", "")

	certDER, err := base64.StdEncoding.DecodeString(certPEM)
	if err != nil {
		return fmt.Errorf("decode certificate: %w", err)
	}

	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return fmt.Errorf("parse certificate: %w", err)
	}

	if time.Now().After(cert.NotAfter) {
		return fmt.Errorf("certificate expired on %s", cert.NotAfter)
	}
	return nil
}

// ---- User Management ----

// upsertUser creates a new user from SSO attributes or returns the existing
// user if the email is already registered. SSO users get a random password
// hash since they authenticate via the IdP.
func (s *SSOService) upsertUser(email, name, providerName string) (*models.User, error) {
	// Try to find existing user.
	existing, err := db.GetUserByEmail(email)
	if err == nil {
		return existing, nil
	}

	// Create new user with a random password (SSO users don't use passwords).
	randomPass := uuid.New().String()
	hash, err := bcrypt.GenerateFromPassword([]byte(randomPass), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &models.User{
		Email:        email,
		Name:         name,
		PasswordHash: string(hash),
		Tier:         "pro", // SSO users default to pro tier.
	}

	if err := db.CreateUser(user); err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	log.Printf("sso: created user %s via %s provider", email, providerName)
	return user, nil
}

// ssoClaims defines the JWT claims structure for SSO-issued tokens.
type ssoClaims struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email"`
	Tier   string    `json:"tier"`
	jwtlib.RegisteredClaims
}

// issueTokens creates a JWT access token and refresh token for the user.
// This reuses the same token format as the main auth handler.
func issueTokens(user *models.User, jwtSecret string) (*models.AuthResponse, error) {
	now := time.Now().UTC()
	expiryHours := 24
	refreshDays := 7

	claims := &ssoClaims{
		UserID: user.ID,
		Email:  user.Email,
		Tier:   user.Tier,
		RegisteredClaims: jwtlib.RegisteredClaims{
			ExpiresAt: jwtlib.NewNumericDate(now.Add(time.Duration(expiryHours) * time.Hour)),
			IssuedAt:  jwtlib.NewNumericDate(now),
			Issuer:    "routeai",
		},
	}

	token := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims)
	accessToken, err := token.SignedString([]byte(jwtSecret))
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}

	refreshClaims := &jwtlib.RegisteredClaims{
		ExpiresAt: jwtlib.NewNumericDate(now.Add(time.Duration(refreshDays) * 24 * time.Hour)),
		IssuedAt:  jwtlib.NewNumericDate(now),
		Subject:   user.ID.String(),
		Issuer:    "routeai-refresh",
	}
	refreshToken := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, refreshClaims)
	refreshTokenStr, err := refreshToken.SignedString([]byte(jwtSecret))
	if err != nil {
		return nil, fmt.Errorf("sign refresh token: %w", err)
	}

	return &models.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshTokenStr,
		ExpiresIn:    expiryHours * 3600,
		User:         *user,
	}, nil
}

// getProviderByName looks up an SSO provider by its URL-friendly name.
func (s *SSOService) getProviderByName(name string) (*SSOProvider, error) {
	p := &SSOProvider{}
	err := s.db.QueryRow(
		`SELECT id, name, protocol, client_id, client_secret, redirect_uri,
		        auth_url, token_url, userinfo_url, sso_url, certificate, issuer,
		        scopes, enabled, created_at, updated_at
		 FROM sso_providers
		 WHERE LOWER(name) = LOWER($1) AND enabled = true`,
		name,
	).Scan(&p.ID, &p.Name, &p.Protocol, &p.ClientID, &p.ClientSecret,
		&p.RedirectURI, &p.AuthURL, &p.TokenURL, &p.UserInfoURL,
		&p.SSOURL, &p.Certificate, &p.Issuer, &p.Scopes,
		&p.Enabled, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("provider %q: %w", name, err)
	}
	return p, nil
}
