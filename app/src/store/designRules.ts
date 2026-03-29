// ─── Design Rules System ────────────────────────────────────────────────────
// Global, per-net-class, and per-net design rules for PCB layout.
// All dimensions in millimeters.

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DesignRule {
  clearance: number;        // Minimum copper-to-copper clearance
  minTraceWidth: number;    // Minimum trace width
  maxTraceWidth: number;    // Maximum trace width
  preferredTraceWidth: number;
  minViaDrill: number;      // Minimum via drill diameter
  minViaAnnularRing: number;
  preferredViaSize: number; // Outer diameter
  preferredViaDrill: number;
  minThroughHole: number;   // Minimum through-hole drill
  minAnnularRing: number;
  // Spacing
  padToPadClearance: number;
  padToTrackClearance: number;
  trackToTrackClearance: number;
  copperToEdgeClearance: number;
  silkToPadClearance: number;
  // Solder mask
  solderMaskExpansion: number;
  solderPasteMargin: number;
  solderPasteRatio: number; // 0 to 1
}

export interface NetClassRule {
  name: string;
  description: string;
  clearance: number;
  traceWidth: number;
  viaDrill: number;
  viaSize: number;
  diffPairWidth?: number;
  diffPairGap?: number;
}

export interface NetOverride {
  netId: string;
  netName: string;
  clearance?: number;
  traceWidth?: number;
  viaDrill?: number;
  viaSize?: number;
  netClass?: string;
}

export interface DesignRulesConfig {
  global: DesignRule;
  netClasses: NetClassRule[];
  netOverrides: NetOverride[];
}

// ─── Default global rules ───────────────────────────────────────────────────

export function defaultGlobalRules(): DesignRule {
  return {
    clearance: 0.2,
    minTraceWidth: 0.15,
    maxTraceWidth: 5.0,
    preferredTraceWidth: 0.25,
    minViaDrill: 0.2,
    minViaAnnularRing: 0.13,
    preferredViaSize: 0.6,
    preferredViaDrill: 0.3,
    minThroughHole: 0.2,
    minAnnularRing: 0.13,
    padToPadClearance: 0.2,
    padToTrackClearance: 0.2,
    trackToTrackClearance: 0.2,
    copperToEdgeClearance: 0.3,
    silkToPadClearance: 0.15,
    solderMaskExpansion: 0.05,
    solderPasteMargin: -0.05,
    solderPasteRatio: 0.9,
  };
}

// ─── Default net class ──────────────────────────────────────────────────────

export function defaultNetClass(): NetClassRule {
  return {
    name: 'Default',
    description: 'Default net class for all signals',
    clearance: 0.2,
    traceWidth: 0.25,
    viaDrill: 0.3,
    viaSize: 0.6,
  };
}

// ─── Predefined profiles ────────────────────────────────────────────────────

export interface DesignProfile {
  name: string;
  description: string;
  global: DesignRule;
  netClasses: NetClassRule[];
}

export const DESIGN_PROFILES: Record<string, DesignProfile> = {
  default: {
    name: 'Default',
    description: 'Standard 2-layer board, suitable for most hobby/prototype designs.',
    global: defaultGlobalRules(),
    netClasses: [
      defaultNetClass(),
    ],
  },

  highSpeed: {
    name: 'High-Speed',
    description: 'Tighter tolerances for USB, HDMI, Ethernet, and other high-speed signals.',
    global: {
      ...defaultGlobalRules(),
      clearance: 0.15,
      minTraceWidth: 0.1,
      preferredTraceWidth: 0.15,
      minViaDrill: 0.15,
      preferredViaDrill: 0.2,
      preferredViaSize: 0.45,
      trackToTrackClearance: 0.15,
      padToTrackClearance: 0.15,
    },
    netClasses: [
      {
        name: 'Default',
        description: 'Standard signals',
        clearance: 0.15,
        traceWidth: 0.15,
        viaDrill: 0.2,
        viaSize: 0.45,
      },
      {
        name: 'USB',
        description: 'USB 2.0 differential pair (90 ohm)',
        clearance: 0.15,
        traceWidth: 0.3,
        viaDrill: 0.2,
        viaSize: 0.45,
        diffPairWidth: 0.3,
        diffPairGap: 0.15,
      },
      {
        name: 'Ethernet',
        description: 'Ethernet differential pairs (100 ohm)',
        clearance: 0.15,
        traceWidth: 0.2,
        viaDrill: 0.2,
        viaSize: 0.45,
        diffPairWidth: 0.2,
        diffPairGap: 0.18,
      },
    ],
  },

  power: {
    name: 'Power',
    description: 'Wide traces and generous clearances for power distribution boards.',
    global: {
      ...defaultGlobalRules(),
      clearance: 0.3,
      minTraceWidth: 0.25,
      preferredTraceWidth: 0.5,
      maxTraceWidth: 10.0,
      minViaDrill: 0.3,
      preferredViaDrill: 0.4,
      preferredViaSize: 0.8,
      minAnnularRing: 0.2,
      padToPadClearance: 0.3,
      padToTrackClearance: 0.3,
      trackToTrackClearance: 0.3,
      copperToEdgeClearance: 0.5,
    },
    netClasses: [
      {
        name: 'Default',
        description: 'Signal traces',
        clearance: 0.3,
        traceWidth: 0.3,
        viaDrill: 0.3,
        viaSize: 0.8,
      },
      {
        name: 'Power',
        description: 'Power rails (VCC, GND, 12V, etc.)',
        clearance: 0.4,
        traceWidth: 1.0,
        viaDrill: 0.4,
        viaSize: 1.0,
      },
      {
        name: 'HighCurrent',
        description: 'High-current paths (>2A)',
        clearance: 0.5,
        traceWidth: 2.0,
        viaDrill: 0.5,
        viaSize: 1.2,
      },
    ],
  },

  finePitch: {
    name: 'Fine-Pitch',
    description: 'For BGA and fine-pitch QFN/QFP components with tight clearances.',
    global: {
      ...defaultGlobalRules(),
      clearance: 0.1,
      minTraceWidth: 0.1,
      preferredTraceWidth: 0.127,
      minViaDrill: 0.1,
      minViaAnnularRing: 0.075,
      preferredViaDrill: 0.15,
      preferredViaSize: 0.35,
      minAnnularRing: 0.075,
      padToPadClearance: 0.1,
      padToTrackClearance: 0.1,
      trackToTrackClearance: 0.1,
      copperToEdgeClearance: 0.25,
      solderMaskExpansion: 0.03,
      solderPasteMargin: -0.03,
    },
    netClasses: [
      {
        name: 'Default',
        description: 'Standard signals (fine pitch)',
        clearance: 0.1,
        traceWidth: 0.127,
        viaDrill: 0.15,
        viaSize: 0.35,
      },
      {
        name: 'BGA_Escape',
        description: 'BGA breakout routing',
        clearance: 0.1,
        traceWidth: 0.1,
        viaDrill: 0.1,
        viaSize: 0.3,
      },
    ],
  },
};

// ─── Resolve effective rules for a given net ────────────────────────────────

/**
 * Given a net ID, resolve the effective design rules by checking
 * per-net overrides first, then net class, then global defaults.
 */
export function resolveRulesForNet(
  netId: string,
  config: DesignRulesConfig,
): { clearance: number; traceWidth: number; viaDrill: number; viaSize: number } {
  // Check per-net overrides
  const override = config.netOverrides.find(o => o.netId === netId);
  if (override) {
    const ncName = override.netClass || 'Default';
    const nc = config.netClasses.find(c => c.name === ncName) || defaultNetClass();
    return {
      clearance: override.clearance ?? nc.clearance,
      traceWidth: override.traceWidth ?? nc.traceWidth,
      viaDrill: override.viaDrill ?? nc.viaDrill,
      viaSize: override.viaSize ?? nc.viaSize,
    };
  }

  // Use default net class
  const nc = config.netClasses.find(c => c.name === 'Default') || defaultNetClass();
  return {
    clearance: nc.clearance,
    traceWidth: nc.traceWidth,
    viaDrill: nc.viaDrill,
    viaSize: nc.viaSize,
  };
}

// ─── Create default config ──────────────────────────────────────────────────

export function createDefaultDesignRules(): DesignRulesConfig {
  return {
    global: defaultGlobalRules(),
    netClasses: [defaultNetClass()],
    netOverrides: [],
  };
}

/**
 * Create a DesignRulesConfig from a named profile.
 */
export function createDesignRulesFromProfile(profileName: string): DesignRulesConfig {
  const profile = DESIGN_PROFILES[profileName];
  if (!profile) return createDefaultDesignRules();
  return {
    global: { ...profile.global },
    netClasses: profile.netClasses.map(nc => ({ ...nc })),
    netOverrides: [],
  };
}
