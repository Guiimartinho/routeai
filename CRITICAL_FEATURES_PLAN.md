---
name: 7 Critical Missing Features - Deep Research & Implementation Plan
description: Comprehensive research on best tools, libraries, and approaches for each missing feature. Based on web research of actual production tools.
type: project
---

# 7 Critical Missing Features — Deep Research

---

## 1. HIERARCHICAL SCHEMATICS (Multi-Sheet)

### O que é:
Projetos reais têm 5-50 páginas de esquemático. Cada sheet tem sua própria página, com hierarchical pins conectando entre sheets.

### Como KiCad faz:
- Cada sheet é um arquivo `.kicad_sch` separado
- Sheet pai contém `(sheet (at x y) (size w h) (fields ...) (pin "name" input/output (at x y)))`
- Hierarchical labels conectam nets entre sheets
- Power symbols (GND, VCC) são globais automaticamente

### Implementação para RouteAI:

**Data Model (types/index.ts):**
```typescript
interface SchSheet {
  id: string;
  name: string;
  fileName: string;
  x: number; y: number;    // position on parent sheet
  width: number; height: number;
  pins: SchHierarchicalPin[];  // connections to parent
}

interface SchHierarchicalPin {
  id: string;
  name: string;
  type: 'input' | 'output' | 'bidirectional' | 'passive';
  x: number; y: number;     // position on sheet border
}

interface SchematicState {
  sheets: SchSheet[];        // NEW: list of sub-sheets
  activeSheetId: string;     // NEW: which sheet is being edited
  // existing: components, wires, labels per sheet
}
```

**UI Changes:**
- Sheet tabs at bottom of schematic editor (like browser tabs)
- "Add Sheet" button in toolbar
- Hierarchical pin tool (place on sheet border)
- Sheet navigation tree (sidebar)
- Global vs local label distinction

**Netlist:** Existing UnionFind netlist extraction works — just needs to traverse ALL sheets and connect via hierarchical pins.

**Effort:** HARD (2-3 weeks)
**Dependencies:** None

---

## 2. 3D VIEWER

### Melhor abordagem:
**react-three-fiber** (@react-three/fiber) + **opencascade.js** para STEP files

### Bibliotecas:
- [react-three-fiber](https://r3f.docs.pmnd.rs/) — React renderer para Three.js (já no package.json do packages/web!)
- [@react-three/drei](https://drei.docs.pmnd.rs/) — helpers (OrbitControls, etc.)
- [opencascade.js](https://ocjs.org/) — OpenCASCADE compilado para WASM, lê STEP/IGES/BREP
- Alternativa: converter STEP → GLTF server-side com FreeCAD/CadQuery

### Implementação:

**Renderização da PCB em 3D:**
```
Board = green extruded rectangle (outline × thickness)
Components = boxes com altura baseada no package type
Traces = flat copper-colored paths extrudados 0.035mm
Vias = cylinders atravessando layers
Solder mask = semi-transparent green/red layer
Silkscreen = white text labels
```

**Para componentes 3D reais (STEP):**
- KiCad tem ~15,000 modelos 3D em https://github.com/KiCad/kicad-packages3D
- Formato: .wrl (VRML) e .step
- opencascade.js lê STEP no browser via WASM
- Alternativa: pré-converter para GLTF (menor, mais rápido)

**Arquivo:** `app/src/components/BoardViewer3D.tsx`
- Substituir o placeholder Viewer3D atual
- Canvas com OrbitControls (rotate, zoom, pan)
- Layer toggle (mostrar/esconder F.Cu, B.Cu, silk, mask)
- Raycasting para click em componentes
- Measurement tool 3D

**Effort:** MEDIUM (1-2 semanas para board básico, 3-4 semanas com STEP models)
**Dependencies:** react-three-fiber (já instalado), opencascade.js (npm install)

---

## 3. KICAD IMPORT NATIVO

### O que já temos:
- Parser completo em Python: `packages/parsers/src/routeai_parsers/kicad/pcb_parser.py` e `sch_parser.py`
- S-expression tokenizer: `sexpr.py`
- Modelo intermediário: `models.py` (BoardDesign, SchematicDesign)
- Converter: `converter.py` (parser models → core models)
- Exporter: `exporter.py` e `sch_exporter.py`

### O que falta:
1. **Frontend file picker** que aceita .kicad_pcb / .kicad_sch
2. **Backend endpoint** que recebe o arquivo, parseia, e retorna JSON para o frontend
3. **Mapping** do modelo intermediário para o formato do app/ (SchComponent, BrdComponent)

### Implementação:

**Backend (já existe, só precisa expor):**
```
POST /api/import/kicad — recebe .kicad_pcb ou .kicad_sch
  → KiCadPcbParser.parse(file) ou KiCadSchParser.parse(file)
  → converter.BoardConverter.to_core()
  → retorna JSON com components, traces, pads, vias, nets
```

**Frontend:**
- Botão "Import KiCad" no File menu
- Aceita: .kicad_pcb, .kicad_sch, .kicad_pro (zip)
- Converte para SchematicState + BoardState do app
- Pin positions do KiCad → nosso coordinate system

**Effort:** EASY (3-5 dias — parser já existe!)
**Dependencies:** Parser Python já funciona (169/169 testes passando)

---

## 4. SPICE SIMULATION

### Melhor abordagem:
**ngspice compilado para WebAssembly** (roda no browser, zero server)

### Bibliotecas:
- [ngspice.js](https://ngspice.js.org/) — ngspice → WASM via Emscripten
- [tscircuit/ngspice](https://github.com/tscircuit/ngspice) — fork otimizado para browser
- [EEcircuit](https://github.com/eelab-dev/EEcircuit) — simulator completo baseado em ngspice WASM

### Implementação:

**Netlist SPICE generation:**
```
Cada SchComponent → linha SPICE:
  R1 → R R1 net1 net2 10k
  C1 → C C1 net1 GND 100n
  U1 → .subckt STM32F103 (ou modelo simplificado)
  V1 → V V1 VCC GND 3.3
```

**Análises suportadas:**
- DC operating point (.op)
- Transient (.tran)
- AC sweep (.ac)
- DC sweep (.dc)

**UI:**
- Tab "Simulation" no app
- Botão "Run Simulation"
- Gráfico de formas de onda (Plotly.js ou Chart.js)
- Probe tool: click num net → mostra voltage/current waveform
- Simulation config: type, time range, step size

**Effort:** HARD (3-4 semanas)
**Dependencies:** ngspice WASM (~5MB download), Plotly.js para gráficos

---

## 5. BLIND/BURIED VIAS COMPLETO

### O que já temos:
- Via type enum no types/index.ts (through, blind, buried, micro)
- StackupEditor com via config
- DRC engine com via drill check
- C++ router com via placement

### O que falta:
1. **UI para selecionar tipo de via** durante routing
2. **Layer pair selector** (blind: F.Cu→In1.Cu, buried: In1.Cu→In2.Cu)
3. **DRC rules** específicas por tipo de via (min drill different for micro vias)
4. **Visual distinction** no board renderer (diferentes cores/symbols por tipo)
5. **Gerber export** com drill files separados por via type

### Implementação:

**Data Model:**
```typescript
interface BrdVia {
  // existing fields...
  viaType: 'through' | 'blind' | 'buried' | 'micro';
  startLayer: string;  // "F.Cu"
  endLayer: string;    // "In1.Cu" (for blind), "B.Cu" (for through)
}
```

**UI:**
- Via type dropdown no BoardEditor toolbar (ao lado do via tool)
- Layer pair picker (shows only valid combinations based on stackup)
- Different rendering: through=full circle, blind=half-circle, buried=dashed, micro=small dot

**Effort:** MEDIUM (1 semana)
**Dependencies:** Stackup editor (já existe)

---

## 6. VERSION CONTROL (Git)

### Melhor abordagem:
**isomorphic-git** — implementação pura de Git em JavaScript, funciona no browser E no Node/Electron

### Biblioteca:
- [isomorphic-git](https://isomorphic-git.org/) — Git puro em JS (npm install isomorphic-git)
- [lightning-fs](https://github.com/nicolo-ribaudo/lightning-fs) — filesystem virtual para browser (do mesmo autor)
- No Electron: usa o Git nativo do sistema via child_process

### Implementação:

**Para Electron (desktop):**
```javascript
import git from 'isomorphic-git';
import fs from 'fs';

// Init repo
await git.init({ fs, dir: projectPath });

// Commit
await git.add({ fs, dir: projectPath, filepath: 'project.routeai' });
await git.commit({
  fs, dir: projectPath,
  message: 'Added bypass caps to U1',
  author: { name: 'Luiz', email: 'luiz@routeai.com' }
});

// Diff
const log = await git.log({ fs, dir: projectPath });

// Push to GitHub
await git.push({ fs, dir: projectPath, remote: 'origin' });
```

**Para Browser:**
```javascript
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@nicolo-ribaudo/lightning-fs';

const fs = new LightningFS('routeai-git');
// Same API works in browser
```

**UI:**
- "Git" panel/tab no app
- Commit history (log com diff visual)
- Commit button com message input
- Branch selector
- Push/Pull buttons (para GitHub/GitLab)
- Diff viewer: mostra componentes adicionados/removidos/movidos visualmente
- Auto-commit on save (opcional)

**Effort:** MEDIUM (1-2 semanas)
**Dependencies:** isomorphic-git (npm), lightning-fs (browser) ou fs (Electron)

---

## 7. PDF EXPORT

### Melhor abordagem:
**jsPDF + html2canvas** (mais prático) OU **svg2pdf.js** (melhor qualidade para SVG)

### Bibliotecas:
- [jsPDF](https://github.com/parallax/jsPDF) — geração de PDF client-side
- [html2canvas](https://html2canvas.hertzen.com/) — renderiza HTML/SVG para canvas
- [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) — converte SVG diretamente para PDF (vetorial, não rasterizado!)
- Alternativa: [@react-pdf/renderer](https://react-pdf.org/) — gera PDF programaticamente

### Implementação:

**Para Schematic (SVG-based):**
```javascript
import { jsPDF } from 'jspdf';
import svg2pdf from 'svg2pdf.js';

const svgElement = document.querySelector('#schematic-svg');
const pdf = new jsPDF('landscape', 'mm', 'a3');

// Title block
pdf.setFontSize(12);
pdf.text(`Project: ${projectName}`, 10, 10);
pdf.text(`Sheet: ${sheetNumber}/${totalSheets}`, 10, 18);
pdf.text(`Date: ${date}`, 10, 26);
pdf.text(`Rev: ${revision}`, 10, 34);

// Render SVG to PDF (vetorial, não rasterizado!)
await svg2pdf(svgElement, pdf, {
  xOffset: 10, yOffset: 40,
  width: 400, height: 260,
});

pdf.save(`${projectName}_schematic.pdf`);
```

**Para Board (Canvas-based):**
```javascript
// Render board canvas to image
const canvas = boardCanvasRef.current;
const imgData = canvas.toDataURL('image/png', 1.0);
const pdf = new jsPDF('landscape', 'mm', 'a3');
pdf.addImage(imgData, 'PNG', 10, 40, 400, 260);
pdf.save(`${projectName}_board.pdf`);
```

**Features do PDF export:**
- Page size selector (A4, A3, Letter, Legal)
- Orientation (landscape/portrait)
- Title block com: project name, date, revision, author, company
- Layer selection (quais layers incluir)
- Scale selector (1:1, fit to page, custom)
- Multi-page para hierarquical schematics
- Color/B&W toggle
- Include BOM page option
- Include assembly drawing option

**Effort:** EASY (3-5 dias)
**Dependencies:** jsPDF + svg2pdf.js (npm install)

---

## RESUMO DE ESFORÇO

| # | Feature | Esforço | Bibliotecas | Risco |
|---|---------|---------|------------|-------|
| 1 | Hierarchical Schematics | 2-3 sem | Nenhuma nova | Alto (data model change) |
| 2 | 3D Viewer | 1-2 sem (basic) | react-three-fiber, opencascade.js | Médio |
| 3 | KiCad Import | 3-5 dias | Parser já existe! | Baixo |
| 4 | SPICE Simulation | 3-4 sem | ngspice WASM, Plotly.js | Alto |
| 5 | Blind/Buried Vias | 1 sem | Nenhuma nova | Baixo |
| 6 | Git Version Control | 1-2 sem | isomorphic-git, lightning-fs | Médio |
| 7 | PDF Export | 3-5 dias | jsPDF, svg2pdf.js | Baixo |

## ORDEM DE IMPLEMENTAÇÃO RECOMENDADA:
1. **PDF Export** (3 dias, baixo risco, alta visibilidade)
2. **KiCad Import** (5 dias, parser pronto, alta demanda)
3. **Blind/Buried Vias** (1 semana, completa feature existente)
4. **3D Viewer** (2 semanas, impressiona visualmente)
5. **Git Version Control** (2 semanas, profissionaliza)
6. **Hierarchical Schematics** (3 semanas, permite projetos grandes)
7. **SPICE Simulation** (4 semanas, diferencial técnico)
