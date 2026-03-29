// ─── TemplateDialog.tsx ─ Design Template Selection & Generation ──────────────
import React, { useState, useCallback, useMemo } from 'react';
import { theme } from '../styles/theme';
import {
  DESIGN_TEMPLATES,
  getTemplateCategories,
  searchTemplates,
  type DesignTemplate,
  type TemplateParams,
  type TemplateResult,
} from '../engine/designTemplates';

// ─── Props ───────────────────────────────────────────────────────────────────

interface TemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (result: TemplateResult, templateName: string) => void;
}

// ─── TemplateDialog Component ────────────────────────────────────────────────

const TemplateDialog: React.FC<TemplateDialogProps> = ({ open, onClose, onGenerate }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedTemplate, setSelectedTemplate] = useState<DesignTemplate | null>(null);
  const [params, setParams] = useState<TemplateParams>({});
  const [showPreview, setShowPreview] = useState(false);
  const [previewResult, setPreviewResult] = useState<TemplateResult | null>(null);

  const categories = useMemo(() => getTemplateCategories(), []);
  const filteredTemplates = useMemo(
    () => searchTemplates(searchQuery, activeCategory),
    [searchQuery, activeCategory]
  );

  const handleSelectTemplate = useCallback((template: DesignTemplate) => {
    setSelectedTemplate(template);
    setShowPreview(false);
    setPreviewResult(null);
    // Initialize params with defaults
    const defaultParams: TemplateParams = {};
    if (template.params?.voltage) {
      defaultParams.voltage = template.params.voltage.default;
    }
    if (template.params?.mcu) {
      defaultParams.mcu = template.params.mcu.default;
    }
    if (template.params?.interfaces) {
      defaultParams.interfaces = [...template.params.interfaces.default];
    }
    setParams(defaultParams);
  }, []);

  const handlePreview = useCallback(() => {
    if (!selectedTemplate) return;
    const result = selectedTemplate.generate(params);
    setPreviewResult(result);
    setShowPreview(true);
  }, [selectedTemplate, params]);

  const handleGenerate = useCallback(() => {
    if (!selectedTemplate) return;
    const result = previewResult ?? selectedTemplate.generate(params);
    onGenerate(result, selectedTemplate.name);
    onClose();
    // Reset state
    setSelectedTemplate(null);
    setShowPreview(false);
    setPreviewResult(null);
    setSearchQuery('');
    setActiveCategory('All');
  }, [selectedTemplate, params, previewResult, onGenerate, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 3000,
        fontFamily: theme.fontSans,
      }}
      onClick={handleBackdropClick}
    >
      <div style={{
        background: theme.bg1,
        border: `1px solid ${theme.bg3}`,
        borderRadius: '12px',
        width: '840px',
        maxWidth: '95vw',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${theme.bg3}`,
        }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: '18px', fontWeight: 700,
              color: theme.textPrimary,
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              {'\u2B22'} Design Templates
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.textMuted }}>
              Pre-built circuit templates with real component data and connections
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: theme.textMuted, fontSize: '20px',
              cursor: 'pointer', padding: '4px 8px',
              borderRadius: '4px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = theme.textPrimary)}
            onMouseLeave={e => (e.currentTarget.style.color = theme.textMuted)}
          >
            {'\u2715'}
          </button>
        </div>

        {/* Search + Category filter */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '12px 20px',
          borderBottom: `1px solid ${theme.bg3}`,
          flexWrap: 'wrap',
        }}>
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              flex: 1, minWidth: '200px',
              background: theme.bg2,
              border: `1px solid ${theme.bg3}`,
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
              fontFamily: theme.fontSans,
              color: theme.textPrimary,
              outline: 'none',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = theme.blue)}
            onBlur={e => (e.currentTarget.style.borderColor = theme.bg3)}
          />
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  background: activeCategory === cat ? theme.blueDim : theme.bg2,
                  border: `1px solid ${activeCategory === cat ? theme.blue : theme.bg3}`,
                  borderRadius: '14px',
                  padding: '4px 12px',
                  fontSize: '11px',
                  fontFamily: theme.fontSans,
                  fontWeight: activeCategory === cat ? 600 : 400,
                  color: activeCategory === cat ? theme.blue : theme.textSecondary,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                  whiteSpace: 'nowrap',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Body: template grid or detail view */}
        <div style={{
          flex: 1, overflow: 'auto',
          display: 'flex',
        }}>
          {/* Template Grid */}
          <div style={{
            flex: selectedTemplate ? '0 0 340px' : 1,
            overflow: 'auto',
            padding: '16px 20px',
            borderRight: selectedTemplate ? `1px solid ${theme.bg3}` : 'none',
          }}>
            {filteredTemplates.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '40px 0',
                color: theme.textMuted, fontSize: '13px',
              }}>
                No templates match your search.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: selectedTemplate ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '10px',
              }}>
                {filteredTemplates.map(tpl => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    selected={selectedTemplate?.id === tpl.id}
                    compact={!!selectedTemplate}
                    onClick={() => handleSelectTemplate(tpl)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedTemplate && (
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}>
              {/* Template info */}
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px',
                }}>
                  <span style={{ fontSize: '28px' }}>{selectedTemplate.icon}</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: theme.textPrimary }}>
                      {selectedTemplate.name}
                    </h3>
                    <span style={{
                      fontSize: '10px', fontWeight: 600,
                      color: theme.blue, textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      {selectedTemplate.category}
                    </span>
                  </div>
                </div>
                <p style={{
                  margin: 0, fontSize: '13px', color: theme.textSecondary,
                  lineHeight: 1.5,
                }}>
                  {selectedTemplate.description}
                </p>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {selectedTemplate.tags.map(tag => (
                    <span key={tag} style={{
                      background: theme.bg2,
                      border: `1px solid ${theme.bg3}`,
                      borderRadius: '10px',
                      padding: '2px 8px',
                      fontSize: '10px',
                      color: theme.textMuted,
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Parameters */}
              {selectedTemplate.params && (
                <div style={{
                  background: theme.bg2,
                  borderRadius: '8px',
                  padding: '14px',
                  border: `1px solid ${theme.bg3}`,
                }}>
                  <div style={{
                    fontSize: '11px', fontWeight: 600,
                    color: theme.textMuted, textTransform: 'uppercase',
                    letterSpacing: '0.5px', marginBottom: '10px',
                  }}>
                    Parameters
                  </div>

                  {selectedTemplate.params.voltage && (
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        fontSize: '12px', color: theme.textSecondary,
                      }}>
                        Output Voltage:
                        <input
                          type="number"
                          min={selectedTemplate.params.voltage.min}
                          max={selectedTemplate.params.voltage.max}
                          step={0.1}
                          value={params.voltage ?? selectedTemplate.params.voltage.default}
                          onChange={e => setParams(p => ({ ...p, voltage: parseFloat(e.target.value) || 3.3 }))}
                          style={{
                            width: '70px',
                            background: theme.bg1,
                            border: `1px solid ${theme.bg3}`,
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '12px',
                            fontFamily: theme.fontMono,
                            color: theme.textPrimary,
                            outline: 'none',
                          }}
                        />
                        <span style={{ color: theme.textMuted }}>V</span>
                        <span style={{
                          fontSize: '10px', color: theme.textMuted,
                        }}>
                          ({selectedTemplate.params.voltage.min}-{selectedTemplate.params.voltage.max}V)
                        </span>
                      </label>
                    </div>
                  )}

                  {selectedTemplate.params.mcu && (
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        fontSize: '12px', color: theme.textSecondary,
                      }}>
                        MCU:
                        <select
                          value={params.mcu ?? selectedTemplate.params.mcu.default}
                          onChange={e => setParams(p => ({ ...p, mcu: e.target.value }))}
                          style={{
                            background: theme.bg1,
                            border: `1px solid ${theme.bg3}`,
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '12px',
                            fontFamily: theme.fontMono,
                            color: theme.textPrimary,
                            outline: 'none',
                          }}
                        >
                          {selectedTemplate.params.mcu.options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Preview */}
              {showPreview && previewResult && (
                <div style={{
                  background: theme.bg2,
                  borderRadius: '8px',
                  padding: '14px',
                  border: `1px solid ${theme.bg3}`,
                  flex: 1,
                  overflow: 'auto',
                }}>
                  <div style={{
                    fontSize: '11px', fontWeight: 600,
                    color: theme.textMuted, textTransform: 'uppercase',
                    letterSpacing: '0.5px', marginBottom: '10px',
                  }}>
                    Preview ({previewResult.components.length} components, {previewResult.wires.length} wires, {previewResult.labels.length} labels)
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '6px',
                    fontSize: '11px',
                    fontFamily: theme.fontMono,
                  }}>
                    {previewResult.components.map((c, i) => (
                      <div key={i} style={{
                        padding: '4px 8px',
                        background: theme.bg1,
                        borderRadius: '4px',
                        color: theme.textSecondary,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '4px',
                      }}>
                        <span style={{ color: theme.blue, fontWeight: 600 }}>{c.ref}</span>
                        <span style={{ color: theme.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{
                display: 'flex', gap: '8px',
                justifyContent: 'flex-end',
                paddingTop: '4px',
              }}>
                <button
                  onClick={handlePreview}
                  style={{
                    background: theme.bg2,
                    border: `1px solid ${theme.bg3}`,
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontFamily: theme.fontSans,
                    fontWeight: 500,
                    color: theme.textSecondary,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = theme.blue;
                    e.currentTarget.style.color = theme.blue;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = theme.bg3;
                    e.currentTarget.style.color = theme.textSecondary;
                  }}
                >
                  {'\u{1F50D}'} Preview
                </button>
                <button
                  onClick={handleGenerate}
                  style={{
                    background: theme.blueDim,
                    border: `1px solid ${theme.blue}`,
                    borderRadius: '6px',
                    padding: '8px 20px',
                    fontSize: '12px',
                    fontFamily: theme.fontSans,
                    fontWeight: 600,
                    color: theme.blue,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = theme.blue;
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = theme.blueDim;
                    e.currentTarget.style.color = theme.blue;
                  }}
                >
                  {'\u2B22'} Generate Schematic
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Template Card ───────────────────────────────────────────────────────────

const TemplateCard: React.FC<{
  template: DesignTemplate;
  selected: boolean;
  compact: boolean;
  onClick: () => void;
}> = ({ template, selected, compact, onClick }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: selected ? theme.blueDim : hovered ? theme.bg3 : theme.bg2,
        border: `1px solid ${selected ? theme.blue : hovered ? theme.blue : theme.bg3}`,
        borderRadius: '8px',
        padding: compact ? '10px 12px' : '16px',
        cursor: 'pointer',
        transition: 'all 0.12s ease',
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        gap: compact ? '10px' : '8px',
        alignItems: compact ? 'center' : 'flex-start',
      }}
    >
      <span style={{
        fontSize: compact ? '20px' : '28px',
        lineHeight: 1,
        flexShrink: 0,
      }}>
        {template.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: compact ? '12px' : '14px',
          fontWeight: 600,
          color: theme.textPrimary,
          marginBottom: compact ? 0 : '4px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {template.name}
        </div>
        {!compact && (
          <>
            <div style={{
              fontSize: '11px',
              color: theme.textMuted,
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {template.description}
            </div>
            <div style={{
              display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap',
            }}>
              <span style={{
                fontSize: '9px',
                fontWeight: 600,
                color: theme.purple,
                background: theme.purpleDim,
                borderRadius: '8px',
                padding: '1px 6px',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
              }}>
                {template.category}
              </span>
              {template.params && (
                <span style={{
                  fontSize: '9px',
                  fontWeight: 500,
                  color: theme.orange,
                  background: theme.orangeDim,
                  borderRadius: '8px',
                  padding: '1px 6px',
                }}>
                  Configurable
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TemplateDialog;
