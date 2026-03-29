# RouteAI EDA — Analise Completa de Tecnologias e Stack

**Data:** 2026-03-25
**Autor:** Analise feita por Claude (Opus 4.6) a pedido de Luiz Guilherme

---

## Avaliacao Tecnologica Completa

### FRONTEND

| O que temos | Alternativa melhor? | Veredicto |
|---|---|---|
| **React + Vite** | Nenhuma melhor para EDA | CORRETO |
| **TypeScript** | — | CORRETO |
| **Zustand** (state) | Redux? Jotai? | CORRETO — Zustand e mais simples e performante |
| **Inline styles** | Tailwind? CSS Modules? | QUESTIONAVEL |
| **SVG** (schematic) | Canvas 2D? WebGL? | LIMITACAO |
| **SVG** (board) | Canvas 2D? WebGL? | ERRADO para producao |

**O problema real:** SVG funciona para 50-100 componentes. Para 500+ componentes num board real, SVG fica lento. EDAs profissionais usam:

```
Schematic: SVG esta OK (poucos elementos, labels, interatividade)
Board PCB: Canvas 2D ou WebGL e OBRIGATORIO para performance
3D Viewer: WebGL (Three.js) — correto, ja planejado
```

**KiCad usa:** Cairo (Canvas 2D) para schematic e board, OpenGL para 3D
**Altium usa:** DirectX/OpenGL nativo
**EasyEDA usa:** Canvas 2D (nao SVG)

---

### BACKEND

| O que temos | Alternativa melhor? | Veredicto |
|---|---|---|
| **Python FastAPI** (main) | — | CORRETO para prototipagem |
| **Go Gin** (API gateway) | — | CORRETO para producao |
| **C++ router** | Rust? | C++ e padrao da industria, Rust seria mais seguro |
| **2 backends** (Python + Go) | So Go? So Python? | COMPLEXIDADE desnecessaria |

**O problema real:** Temos Python E Go fazendo coisas parecidas. Para um produto, deveria ser UM backend:

```
Opcao A (Recomendada): Go para TUDO + Python so para ML/LLM
Opcao B: Python para TUDO (mais simples, mais lento)
Opcao C: Rust para TUDO (mais performante, mais dificil)
```

---

### ENGINES / COMPUTACAO

| O que temos | Alternativa melhor? | Veredicto |
|---|---|---|
| **Python Shapely** (DRC) | C++ Clipper2 | OK para agora, Clipper2 para producao |
| **Python Z3** (constraints) | — | CORRETO — Z3 e o melhor SMT solver |
| **TypeScript engines** (no browser) | WebAssembly? | LIMITACAO |
| **Simulated Annealing** (placement) | DREAMPlace (GPU)? | CORRETO para PCB escala |
| **A*/Lee** (routing) | — | CORRETO — algoritmos classicos para PCB |

**O problema real:** Os engines de DRC, placement, routing estao em **TypeScript rodando no browser**. Para boards reais (500+ componentes), deveria ser:

```
Browser: UI apenas (renderizacao + interacao)
Backend: C++/Rust/Go (calculos pesados via WebSocket/API)
```

KiCad faz TUDO em C++ nativo. O browser so exibe.

---

### LLM / AI

| O que temos | Alternativa melhor? | Veredicto |
|---|---|---|
| **Ollama** (local) | — | CORRETO para privacidade |
| **qwen2.5:7b** | qwen2.5-coder:14b | UPGRADE recomendado |
| **LLM para intent** | — | CORRETO |
| **Solvers para math** | — | CORRETO |
| **Datasheet knowledge base** | RAG com pgvector? | RAG seria melhor |

**O que falta:** Um pipeline RAG real:
```
Datasheet PDF -> chunking -> embedding -> pgvector -> query por similaridade
Ao inves de: JSON hardcoded com 22 familias de ICs
```

---

### DATABASE / INFRA

| O que temos | Alternativa melhor? | Veredicto |
|---|---|---|
| **PostgreSQL + pgvector** | — | CORRETO |
| **MinIO** (S3) | — | CORRETO |
| **Temporal** (workflows) | — | CORRETO para jobs longos |
| **Docker + K8s** | — | CORRETO para deploy |
| **localStorage** (no app) | SQLite? IndexedDB? | LIMITADO |

**O problema real:** O `app/` salva projetos em `localStorage` (5MB limite). Para projetos reais:
```
Desktop: SQLite (sem limite, rapido, queries)
Web: IndexedDB (async, 100MB+, structured)
```

---

### FORMATO DE ARQUIVO

| O que temos | Alternativa melhor? | Veredicto |
|---|---|---|
| **.routeai.json** | KiCad nativo? SQLite? | NAO PADRONIZADO |
| **JSON** (save/load) | Binary? Protobuf? | LENTO para boards grandes |

**O ideal:**
```
Nativo: .routeai (SQLite com schema versionado — como Altium .PcbDoc)
Import: KiCad .kicad_pcb/.kicad_sch  (ja temos parser)
Import: Eagle .brd/.sch  (ja temos parser)
Export: KiCad, Eagle, Gerber, ODB++  (ja temos)
```

---

## Resumo: O que MUDAR para producao

### CRITICO (sem isso nao escala):

```
1. Board renderer: SVG -> Canvas 2D (ou PixiJS/WebGL)
   - SVG trava com 200+ componentes
   - Canvas 2D renderiza 10,000+ componentes a 60fps
   - KiCad, EasyEDA, Figma todos usam Canvas

2. Computacao pesada: TypeScript -> Backend (C++/Go/Rust via API)
   - DRC, placement, routing devem rodar no servidor
   - Browser so para UI
   - WebSocket para streaming de resultados

3. Storage: localStorage -> IndexedDB (web) ou SQLite (desktop)
   - localStorage = 5MB limite
   - Projetos reais tem 10-50MB de dados
```

### RECOMENDADO (melhora qualidade):

```
4. RAG pipeline para datasheets
   - PDF -> chunks -> embeddings -> pgvector
   - Em vez de JSON hardcoded

5. Unificar backends: Python + Go -> Go only (+ Python para ML)
   - Menos complexidade operacional

6. Upgrade LLM: qwen2.5:7b -> qwen2.5-coder:14b
   - Melhor JSON structured output
```

### OK COMO ESTA:

```
- React + TypeScript + Vite + Zustand
- FastAPI para prototipagem
- C++ routing engine
- Ollama para LLM local
- PostgreSQL + pgvector
- Docker + K8s manifests
- Simulated Annealing placement
- Z3 constraint solver
- KiCad/Eagle parsers
- Gerber/Excellon export
```

---

## A stack IDEAL para RouteAI producao seria:

```
Frontend:  React + TypeScript + Vite + Zustand (manter)
Render:    PixiJS ou Canvas 2D (trocar SVG do board)
Desktop:   Electron (empacotar)
Backend:   Go (API + WebSocket) + Python (ML/LLM only)
Engines:   C++ (routing) + Rust (DRC, placement) compiled to WASM
LLM:       Ollama (qwen2.5-coder:14b) local + Claude API cloud
DB:        SQLite (desktop) / PostgreSQL (cloud)
RAG:       pgvector + sentence-transformers embeddings
Format:    SQLite-based .routeai files
```

---

## Comparacao com EDAs existentes

### KiCad 8 (open source, referencia)
```
Linguagem:    C++ (core) + Python (scripting/plugins)
GUI:          wxWidgets + Cairo (2D) + OpenGL (3D)
Rendering:    Cairo Canvas (NOT SVG)
File format:  S-expression text files (.kicad_pcb, .kicad_sch)
DB:           Nenhum (tudo em arquivos)
Router:       Interactive push-and-shove (C++ nativo)
DRC:          C++ nativo com Clipper2 geometry
3D:           OpenCASCADE + OpenGL
Plugins:      Python API
```

### Altium Designer (comercial, $$$)
```
Linguagem:    Delphi/C++ (core)
GUI:          Native Windows UI + DirectX
Rendering:    DirectX/OpenGL hardware accelerated
File format:  Binary OLE compound (.PcbDoc = SQLite-like)
DB:           SQLite embutido nos arquivos
Router:       Situs autorouter + interactive
DRC:          C++ nativo
3D:           DirectX + STEP import
Cloud:        Altium 365 (collaboration)
```

### EasyEDA (web-based, gratuito)
```
Linguagem:    JavaScript (frontend) + Java (backend)
GUI:          Canvas 2D (NOT SVG!)
Rendering:    HTML5 Canvas com custom renderer
File format:  JSON proprietario
DB:           MongoDB (cloud)
Router:       Java-based autorouter
DRC:          JavaScript no browser
3D:           WebGL (Three.js)
Cloud:        LCSC/JLCPCB integration direta
```

### Flux.ai (AI-powered, novo)
```
Linguagem:    TypeScript + Rust (WASM)
GUI:          React + Canvas 2D
Rendering:    HTML5 Canvas + WebGL para 3D
File format:  Cloud-only (proprietario)
AI:           GPT-4 integration
Router:       Rust compiled to WASM
DRC:          Rust WASM
```

---

## Prioridade de mudancas para RouteAI

### Fase Imediata (1-2 semanas):
1. Trocar Board SVG por Canvas 2D (PixiJS ou custom)
2. Empacotar com Electron para desktop
3. Migrar localStorage para IndexedDB

### Fase Curta (1-2 meses):
4. Compilar engines C++ para WASM
5. Implementar RAG pipeline com pgvector
6. Upgrade para qwen2.5-coder:14b

### Fase Media (3-6 meses):
7. Unificar backend (Go primary)
8. Implementar push-and-shove routing nativo
9. 3D viewer com Three.js
10. Format .routeai baseado em SQLite

---

## Metricas atuais do projeto

```
Arquivos TypeScript/TSX:  67
Linhas de codigo:         45,194
Engines:                  15
Componentes React:        35+
Simbolos KiCad:           8,197 (394,006 pinos)
Componentes pesquisaveis: 17,009
Templates de circuito:    10
Familias IC conhecidas:   22 (datasheet) + 25 (generic rules)
Testes Python:            790/796 passing
Agentes de validacao:     55 rodados
Bugs encontrados/fixados: 23/23 (100%)
```
