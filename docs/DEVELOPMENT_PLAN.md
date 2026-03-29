# RouteAI - Plano Completo de Desenvolvimento

> LLM-Powered EDA Platform for PCB Design
> Baseado no Product Development Plan v1.1 - Luiz Guilherme Martinho Sampaio Ito

---

## Visao Geral do Produto

RouteAI e uma plataforma SaaS que usa LLMs especializados + solvers deterministicos para transformar o design de PCBs. O engenheiro descreve a intencao, a IA gera o layout, e o humano revisa/aprova. O diferencial central e a **arquitetura anti-alucinacao**: o LLM propoe, solvers deterministicos validam, o engenheiro comita.

### O Problema que Resolvemos

1. Autorouters atuais exigem 60-80% de retrabalho manual
2. Engenheiros gastam 70% do tempo em roteamento repetitivo
3. Licencas EDA enterprise custam $15K-50K/assento/ano
4. Barreira de entrada massiva para startups de hardware e makers

### A Solucao

Um "Claude Code para PCBs" - o engenheiro conversa com a IA, descreve o que quer, e recebe um layout verificado fisicamente. Cada sugestao vem com citacao (IPC, datasheet, equacao fisica) e e validada por engines deterministicos antes de ser apresentada.

---

## Arquitetura do Sistema

### 5 Camadas Arquiteturais

```
┌─────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                             │
│  React + Three.js (WebGL) | WebSocket | Chat Interface          │
├─────────────────────────────────────────────────────────────────┤
│  ORCHESTRATION LAYER                                            │
│  Go (Gin) API Gateway | Temporal.io Job Queue | Auth/Sessions   │
├─────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE LAYER                                             │
│  Python (FastAPI) | LangChain | RAG (pgvector) | Claude API     │
│  Confidence Scoring | Schema Validation | Prompt Management     │
├─────────────────────────────────────────────────────────────────┤
│  SOLVER LAYER                                                   │
│  C++17 Routing Engine | Clipper2 DRC | Z3 Constraints           │
│  OpenEMS SI/PI | Placement Optimizer | All via gRPC             │
├─────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                     │
│  PostgreSQL + PostGIS + pgvector | MinIO (S3) | Redis Cache     │
│  Unified PCB Data Model | Git-like Design Versioning            │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Anti-Alucinacao: Propose-Verify-Commit

```
LLM Output ──► Gate 1: Domain-Constrained Generation
               │  - JSON Schema tipado (nunca free-form)
               │  - Citacao obrigatoria (IPC, datasheet, equacao)
               │  - Confidence score (0.0-1.0)
               │  - Safety-critical: requer 0.95+ ou rejeicao
               ▼
              Gate 2: Verificacao Deterministica
               │  - DRC Engine (Clipper2): polygon intersection exata
               │  - Physics Engine: Hammerstad-Jensen, IPC-2141
               │  - Constraint Solver (Z3): verificacao formal
               │  - Cross-check: OpenEMS field solver
               ▼
              Gate 3: Interface de Revisao Humana
               │  - Visual diffs (verde=add, azul=mod, amber=flag)
               │  - Rationale em linguagem natural por sugestao
               │  - Commits atomicos e reversiveis
               ▼
              Engenheiro Aprova/Modifica/Rejeita
```

### Modelo de Dados Unificado (Format-Agnostic)

| Dominio       | Entidades                                      | Atributos Chave                                           |
|---------------|------------------------------------------------|-----------------------------------------------------------|
| Schematic     | Components, Nets, Buses, Sheets, Hierarchy     | Symbol, value, footprint mapping, net class, bus topology  |
| Physical      | Footprints, Pads, Traces, Vias, Zones, Outline | Layer, geometry (polygons), drill size, thermal relief     |
| Constraints   | Net Classes, Diff Pairs, Length Groups, Keepouts| Min/max width, clearance, impedance, skew tolerance       |
| Stack-up      | Layers, Materials, Thicknesses                 | Er, loss tangent, copper weight, prepreg/core             |
| Manufacturing | Fab Notes, Assembly Data, BOM                  | Tolerances, finish, solder mask, stencil apertures        |

---

## Catalogo Completo de Algoritmos EDA

### Roteamento

| Algoritmo              | Aplicacao                                       | Complexidade         | Release |
|------------------------|-------------------------------------------------|----------------------|---------|
| Lee/Maze Router        | Caminho mais curto single-net com obstaculos    | O(N^2) grid cells   | V1 Core |
| A* com cost map        | Roteamento ponderado (layers, congestion)       | O(N log N)           | V1 Core |
| Rip-up & Reroute       | Resolver conflitos de roteamento iterativamente | Iterativo convergente| V1 Core |
| Global Routing         | Planejamento grosso antes do detalhado          | Multicommodity flow  | V1 Core |
| Diff Pair Router       | Pares diferenciais com impedancia acoplada      | A* modificado        | V1 Core |
| Length Matching         | Serpentina/trombone para grupos matched          | Constraint propagation| V1 Core|
| Channel Router         | Roteamento de bus paralelo em corredores        | O(N^2)              | V1.1    |
| BGA Fanout             | Escape routing de BGA/QFN                       | Pattern + A*         | V1.1    |
| Topological Router     | Rubber-band para exploracao/otimizacao          | Topology-based       | V1.2    |
| Simulated Annealing    | Otimizacao global placement + routing           | Probabilistico       | V1.2    |

### Placement

| Tecnica                 | Descricao                                       | Release |
|-------------------------|-------------------------------------------------|---------|
| Force-Directed          | Nets como molas, minimizar wire length          | V1 Core |
| Partitioning (FM/KL)    | Min-cut balanceado Fiduccia-Mattheyses          | V1 Core |
| LLM-Guided Floorplan    | Analise esquematica para agrupamento            | V1 Core |
| Quadratic Placement     | Minimizar wire length^2 (otimo global)          | V1.1    |
| Simulated Annealing     | Otimizacao estocastica multi-objetivo           | V1.2    |
| Genetic Algorithm       | Otimizacao evolutiva de placement               | V2      |

### Signal & Power Integrity

| Analise                 | Metodo                                          | Release |
|-------------------------|-------------------------------------------------|---------|
| Impedance Control       | Hammerstad-Jensen + OpenEMS 2D field solver      | V1 Core |
| Crosstalk (FEXT/NEXT)   | Coupled transmission line model, IPC-2141       | V1 Core |
| Return Path Analysis    | Continuidade do plano de referencia, slots/vias | V1 Core |
| PDN Analysis            | Impedancia AC da PDN, otimizacao de decaps      | V1.1    |
| EMI Prediction          | Loop area, common-mode current, radiation       | V1.2    |
| Thermal Analysis        | Rede de resistencia termica, copper spreading   | V1.2    |
| Eye Diagram             | Statistical eye via IBIS + S-parameters         | V2      |

### DRC (IPC-2221B)

- **Geometrico**: clearance (trace-trace, trace-pad, trace-zone, trace-edge), trace width min, annular ring, acid traps, slivers, silk-to-pad
- **Eletrico**: nets desconectadas, curto-circuitos, net-tie, creepage/clearance HV (IPC-2221B Table 6-1)
- **Fabricacao**: drill min, drill-to-copper, solder mask expansion, paste aperture ratio, board outline, panelizacao
- **High-Speed**: descontinuidade de impedancia, stub length, diff pair uncoupled length, violacoes de plano de referencia

---

## FASE 0: Foundation & Validation (Semanas 1-6)

**Objetivo**: Validar viabilidade tecnica core. Responder a pergunta critica: um LLM consegue gerar constraints de PCB corretas de forma confiavel?

**Time**: 1-2 engenheiros

### Semana 1-2: Estrutura do Projeto + Data Model

#### S1-2.1: Setup do Monorepo
```
routeai/
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── Makefile
├── .github/
│   └── workflows/
│       ├── ci.yml              # Build + test em cada PR
│       └── benchmark.yml       # Nightly benchmarks
├── packages/
│   ├── core/                   # Modelo de dados unificado (Python)
│   │   ├── pyproject.toml
│   │   ├── src/routeai_core/
│   │   │   ├── __init__.py
│   │   │   ├── models/         # Pydantic models do PCB data model
│   │   │   │   ├── __init__.py
│   │   │   │   ├── schematic.py    # Component, Net, Bus, Sheet
│   │   │   │   ├── physical.py     # Footprint, Pad, Trace, Via, Zone
│   │   │   │   ├── constraints.py  # NetClass, DiffPair, LengthGroup
│   │   │   │   ├── stackup.py      # Layer, Material, Thickness
│   │   │   │   └── manufacturing.py# BOM, FabNotes, Assembly
│   │   │   ├── geometry.py     # Primitivas geometricas (Point, Polygon, Arc)
│   │   │   └── units.py        # Sistema de unidades (mm, mil, oz)
│   │   └── tests/
│   ├── parsers/                # Parsers de CAD formats (Python)
│   │   ├── pyproject.toml
│   │   ├── src/routeai_parsers/
│   │   │   ├── __init__.py
│   │   │   ├── kicad/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── pcb_parser.py   # .kicad_pcb S-expression parser
│   │   │   │   ├── sch_parser.py   # .kicad_sch parser
│   │   │   │   ├── lib_parser.py   # Symbol/footprint library parser
│   │   │   │   └── exporter.py     # Write back to KiCad format
│   │   │   └── eagle/              # Phase 1+
│   │   └── tests/
│   │       └── fixtures/       # 20 KiCad reference designs
│   ├── intelligence/           # LLM Agent + RAG (Python)
│   │   ├── pyproject.toml
│   │   ├── src/routeai_intelligence/
│   │   │   ├── __init__.py
│   │   │   ├── agent/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── core.py         # ReAct loop principal
│   │   │   │   ├── tools.py        # Tool definitions para o LLM
│   │   │   │   ├── prompts/        # System prompts versionados
│   │   │   │   │   ├── constraint_gen.py
│   │   │   │   │   ├── design_review.py
│   │   │   │   │   └── routing_strategy.py
│   │   │   │   └── schemas/        # JSON Schemas de output do LLM
│   │   │   │       ├── constraint_schema.json
│   │   │   │       ├── placement_schema.json
│   │   │   │       └── routing_schema.json
│   │   │   ├── rag/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── embeddings.py   # Embedding pipeline
│   │   │   │   ├── retriever.py    # pgvector search
│   │   │   │   └── indexer.py      # Ingestao de docs/standards
│   │   │   └── validation/
│   │   │       ├── __init__.py
│   │   │       ├── schema_validator.py   # Gate 1: JSON Schema
│   │   │       ├── confidence.py         # Confidence scoring
│   │   │       └── citation_checker.py   # Verificar citacoes
│   │   └── tests/
│   ├── solver/                 # DRC + Physics engines (Python wrapper, C++ core)
│   │   ├── pyproject.toml
│   │   ├── src/routeai_solver/
│   │   │   ├── __init__.py
│   │   │   ├── drc/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── engine.py       # DRC engine principal
│   │   │   │   ├── geometric.py    # Clearance, width, annular ring
│   │   │   │   ├── electrical.py   # Connectivity, shorts, creepage
│   │   │   │   └── manufacturing.py# Drill, mask, paste
│   │   │   ├── physics/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── impedance.py    # Hammerstad-Jensen + IPC-2141
│   │   │   │   ├── crosstalk.py    # FEXT/NEXT models
│   │   │   │   └── thermal.py      # Thermal resistance network
│   │   │   └── constraints/
│   │   │       ├── __init__.py
│   │   │       └── z3_solver.py    # Z3 SMT constraint verification
│   │   └── tests/
│   ├── api/                    # API Gateway (Go)  -- Phase 1+
│   ├── web/                    # Frontend React    -- Phase 1+
│   └── router/                 # Routing Engine C++ -- Phase 2+
├── data/
│   ├── reference_designs/      # KiCad designs para teste/benchmark
│   ├── ipc_standards/          # Standards indexados para RAG
│   ├── component_library/      # Dados de componentes
│   └── benchmarks/             # Benchmark results
├── scripts/
│   ├── setup.sh                # Dev environment setup
│   ├── seed_rag.py             # Popular knowledge base
│   └── benchmark.py            # Rodar benchmarks
└── infrastructure/
    ├── docker/
    │   ├── Dockerfile.intelligence
    │   ├── Dockerfile.solver
    │   └── Dockerfile.api
    └── k8s/                    # Kubernetes manifests (Phase 4)
```

#### S1-2.2: Unified PCB Data Model (Python/Pydantic)

**Tarefas**:
- [ ] Definir todas as entidades Pydantic do modelo unificado:
  - `Component`: reference, value, footprint, position, rotation, layer, properties
  - `Net`: name, class, pads[], traces[], zones[]
  - `Pad`: shape, size, drill, layers, position, net_ref
  - `Trace`: net_ref, width, layer, points[], arcs[]
  - `Via`: position, drill, layers, net_ref, type (through/blind/buried)
  - `Zone`: net_ref, layer, polygon, fill_type, clearance, min_width
  - `BoardOutline`: polygon, cutouts[]
  - `StackUp`: layers[] com material, thickness, Er, loss_tangent, copper_weight
  - `NetClass`: name, clearance, trace_width, via_drill, diff_pair_width, diff_pair_gap
  - `DiffPair`: positive_net, negative_net, impedance_target, max_skew
  - `LengthGroup`: nets[], target_length, tolerance
  - `DesignRules`: global clearance, min_trace, min_drill, etc.
- [ ] Sistema de unidades com conversao automatica (mm <-> mil <-> inch)
- [ ] Primitivas geometricas: Point, Line, Arc, Polygon, com operacoes booleanas
- [ ] Serializacao JSON completa de todo o modelo
- [ ] Testes unitarios: 100% de cobertura no data model

**Criterio de aceite**: Todo design PCB representavel no modelo, serializacao/deserializacao sem perda, round-trip tests passam.

#### S1-2.3: Setup de Desenvolvimento
- [ ] Poetry para Python (ruff, mypy strict, pytest)
- [ ] docker-compose com PostgreSQL + PostGIS + pgvector + Redis + MinIO
- [ ] GitHub Actions CI: lint + type-check + test em cada PR
- [ ] Pre-commit hooks: ruff, mypy
- [ ] Makefile com targets: `dev`, `test`, `lint`, `benchmark`

### Semana 3-4: KiCad Parser + DRC v0

#### S3-4.1: KiCad Parser (.kicad_pcb + .kicad_sch)

**Tarefas**:
- [ ] Parser de S-expressions do KiCad 8 (tokenizer + AST)
- [ ] `.kicad_pcb` -> modelo unificado:
  - Extrair: layers, nets, footprints, pads, traces (segments + arcs), vias, zones, board outline, design rules, stackup
  - Preservar custom fields e propriedades
- [ ] `.kicad_sch` -> modelo unificado:
  - Extrair: symbols, wires, labels (local + global + hierarchical), buses, sheets, power flags
  - Resolver netlist completa: label matching, hierarquia, power nets
- [ ] Exporter: modelo unificado -> `.kicad_pcb` (write-back)
- [ ] Suite de testes com 20 designs de referencia (simples a complexo):
  - Arduino Uno clone
  - STM32 minimal (LQFP48)
  - ESP32 devkit
  - USB-C PD sink
  - DDR4 SODIMM breakout
  - 4-layer mixed signal
  - BGA breakout (0.8mm pitch)
  - Power supply (buck converter)
  - Sensor board (I2C/SPI)
  - Motor driver (high current)
  - 10 mais variados (RF, flex, HDI, panelizado, etc.)
- [ ] Round-trip test: KiCad -> modelo -> KiCad -> diff = zero

**Criterio de aceite**: 100% fidelidade nos 20 designs de referencia. Parse completo sem perda de dados. Round-trip exato.

#### S3-4.2: DRC Engine v0

**Tarefas**:
- [ ] Geometric DRC:
  - Clearance check (trace-trace, trace-pad, trace-via, trace-zone, pad-pad)
  - Minimum trace width check
  - Minimum annular ring check
  - Board edge clearance
- [ ] Electrical DRC:
  - Connectivity check (unconnected nets)
  - Short circuit detection
- [ ] Validacao contra KiCad DRC:
  - Rodar KiCad DRC programaticamente nos 20 designs
  - Comparar resultados: RouteAI deve pegar TODAS as violacoes que KiCad pega (zero false negatives)
  - False positives aceitaveis nesta fase (< 5%)
- [ ] Usar Shapely (Python) inicialmente, migrar para Clipper2 (C++) na Phase 2

**Criterio de aceite**: Zero false negatives vs KiCad DRC. < 5% false positives. Latencia < 5s para board de 200 componentes.

### Semana 5-6: LLM Constraint Generation + CLI

#### S5-6.1: LLM Agent para Geracao de Constraints

**Tarefas**:
- [ ] System prompt especializado para geracao de design rules:
  - Input: esquematico parseado + lista de componentes + stackup
  - Output: JSON Schema tipado com constraints (net classes, impedancias, length matching, clearances)
- [ ] JSON Schemas de output (Gate 1):
  - `ConstraintSet`: net_classes[], diff_pairs[], length_groups[], special_rules[]
  - Cada campo com `confidence: float`, `source: str` (citacao)
  - Validacao automatica contra schema
- [ ] RAG pipeline v0:
  - Indexar: IPC-2221B (clearance/creepage tables), IPC-2141 (impedance), IPC-7351C (footprints)
  - Indexar: 10 application notes chave (TI DDR4 layout guide, USB design guide, etc.)
  - pgvector embeddings com semantic search
- [ ] Tool-calling setup:
  - Tool `impedance_calc`: calcula impedancia microstrip/stripline dado stackup
  - Tool `clearance_lookup`: busca clearance minima por tensao (IPC-2221B Table 6-1)
  - Tool `datasheet_lookup`: busca specs de componente no RAG
- [ ] Confidence scoring:
  - Parametros safety-critical (clearance, creepage, impedancia): threshold 0.95
  - Parametros gerais: threshold 0.80
  - Abaixo do threshold: flag para revisao humana
- [ ] Benchmark contra 50 designs com rules humanas conhecidas:
  - Comparar constraints gerados vs constraints humanos
  - Target: 95% match rate em parametros criticos

**Criterio de aceite**: 95%+ match em parametros criticos. Zero sugestoes de clearance abaixo do minimo IPC. Todas as sugestoes citam fonte.

#### S5-6.2: CLI Prototype

**Tarefas**:
- [ ] Comando: `routeai analyze <kicad_project_dir>`
- [ ] Output: relatorio de analise em Markdown/JSON:
  - Violations DRC encontradas com localizacao e severidade
  - Constraints sugeridos pelo LLM com citacoes
  - Warnings de impedancia/thermal/manufacturing
  - Score geral do design (0-100)
- [ ] Flags: `--format json|markdown|html`, `--severity critical|warning|info`
- [ ] Latencia end-to-end < 30s para board de 200 componentes

**Criterio de aceite**: CLI funcional que engenheiro pode rodar em projetos existentes e obter feedback acionavel.

### Entregaveis Fase 0
- [x] KiCad parser com 100% fidelidade (20 designs)
- [x] LLM constraint generation com 95%+ match rate
- [x] DRC engine v0 com zero false negatives vs KiCad
- [x] CLI prototype funcional
- [x] Suite de testes e benchmarks automatizados

### Riscos Fase 0 e Mitigacoes
| Risco | Mitigacao |
|-------|-----------|
| Formato KiCad muda entre versoes | Pin no KiCad 8, version detection, parser abstrato |
| LLM gera impedancias plausiveis mas incorretas | Cross-reference com IPC-2141 + datasheet no RAG |
| Latencia do LLM muito alta | Cache agressivo de patterns comuns, batch processing |

---

## FASE 1: Design Review Assistant (Semanas 7-16)

**Objetivo**: Primeiro produto user-facing. O LLM age como um reviewer senior de PCB, analisando designs existentes e dando feedback acionavel. **MVP para validacao de early adopters.**

**Time**: 2-3 engenheiros

### Semana 7-9: Backend + API Gateway

#### S7-9.1: API Gateway (Go)

**Tarefas**:
- [ ] Servidor Go com Gin framework
- [ ] Endpoints REST:
  - `POST /api/v1/projects` - Upload de projeto KiCad/Eagle (zip)
  - `GET /api/v1/projects/:id` - Status e metadata do projeto
  - `POST /api/v1/projects/:id/review` - Iniciar review AI
  - `GET /api/v1/projects/:id/review` - Resultado da review
  - `POST /api/v1/projects/:id/chat` - Perguntas de follow-up
  - `GET /api/v1/projects/:id/board` - Board data para renderer
- [ ] WebSocket endpoint para atualizacoes real-time:
  - Progresso da analise (parsing -> DRC -> LLM -> resultado)
  - Chat streaming (token by token do LLM)
- [ ] Autenticacao: JWT + refresh tokens
- [ ] Rate limiting por tier (Free: 5 reviews/mes, Pro: ilimitado)
- [ ] Upload handling: validacao de formato, limite de tamanho (50MB), virus scan
- [ ] Job dispatch para Temporal.io (analise e review sao async)

#### S7-9.2: Job Orchestration (Temporal.io)

**Tarefas**:
- [ ] Workflow de Design Review:
  ```
  1. ParseProject(zip) -> UnifiedModel
  2. RunDRC(model) -> DRCReport
  3. RunLLMReview(model, drc_report) -> ReviewReport
  4. RunPhysicsChecks(model, review) -> PhysicsReport
  5. MergeReports() -> FinalReport com prioridades
  ```
- [ ] Retry logic: LLM failures retry 3x com backoff
- [ ] Timeout: 120s max por review
- [ ] Progress reporting via WebSocket
- [ ] Cancellation support

#### S7-9.3: Database Schema

**Tarefas**:
- [ ] PostgreSQL schema:
  ```sql
  users (id, email, name, tier, created_at)
  projects (id, user_id, name, format, status, created_at)
  project_files (id, project_id, filename, s3_key, file_type)
  reviews (id, project_id, status, started_at, completed_at)
  review_items (id, review_id, category, severity, message,
                location_json, suggestion, source_citation, confidence)
  chat_messages (id, project_id, role, content, created_at)
  usage_tracking (id, user_id, action, tier, timestamp)
  ```
- [ ] PostGIS para queries espaciais de PCB
- [ ] pgvector para RAG embeddings
- [ ] Migrations com golang-migrate

### Semana 10-12: Frontend Web + PCB Viewer

#### S10-12.1: PCB Viewer WebGL (Three.js)

**Tarefas**:
- [ ] Renderer de PCB 2D em WebGL (Three.js):
  - Camadas de cobre com cores distintas por layer
  - Traces, pads, vias, zones, board outline, silk, mask
  - Pan, zoom (scroll), rotate
  - Seleção de layer visibility (toggle per layer)
  - Hover para highlight de net inteira
  - Click para selecionar componente/trace/via com info panel
- [ ] Overlay de annotations da review:
  - Markers nos pontos com issues (icone por severidade)
  - Click no marker -> mostra detalhes do issue + sugestao
  - Highlight da area afetada (clearance violation = area vermelha)
- [ ] Performance: smooth 60fps com board de 500 componentes
- [ ] Exportar view como PNG/SVG para reports

#### S10-12.2: Interface Web (React)

**Tarefas**:
- [ ] Layout principal:
  ```
  ┌──────────────────────────────────────────────────┐
  │  Header: Logo | Project Name | User Menu         │
  ├────────────┬─────────────────────┬───────────────┤
  │  Sidebar   │   PCB Viewer        │  Chat Panel   │
  │            │   (Three.js)        │               │
  │  - Layers  │                     │  AI Review    │
  │  - Nets    │                     │  Results +    │
  │  - Comps   │                     │  Follow-up    │
  │  - Rules   │                     │  Questions    │
  │            │                     │               │
  ├────────────┴─────────────────────┴───────────────┤
  │  Footer: Status Bar | Review Progress            │
  └──────────────────────────────────────────────────┘
  ```
- [ ] Upload flow:
  1. Drag-and-drop zona (ou file picker)
  2. Validacao client-side do formato
  3. Progress bar de upload
  4. Auto-trigger review apos parse
- [ ] Review results panel:
  - Lista priorizada: Critical (vermelho) > Warning (amarelo) > Info (azul)
  - Cada item: descricao, localizacao (click -> navega no viewer), sugestao, citacao
  - Filtros por categoria (DRC, impedancia, thermal, manufacturing, placement)
  - Estatisticas: total issues, score do design
- [ ] Chat interface:
  - Input de texto + send
  - Streaming de resposta do LLM
  - Respostas referenciam localizacoes no board (clickaveis)
  - Historico persistido por projeto
- [ ] Auth pages: login, register, password reset
- [ ] Dashboard: lista de projetos, usage do tier, upgrade CTA

#### S10-12.3: Eagle Parser (Read-Write)

**Tarefas**:
- [ ] Parser XML para `.brd` e `.sch` do Eagle
- [ ] Mapeamento Eagle -> modelo unificado
- [ ] Suite de testes com 10 designs Eagle de referencia
- [ ] Exporter: modelo unificado -> Eagle XML

### Semana 13-14: KiCad Plugin

#### S13-14.1: Plugin Nativo KiCad

**Tarefas**:
- [ ] KiCad Action Plugin (Python via KiCad API):
  - Menu: "Tools > Review with RouteAI"
  - Right-click context menu em componentes/traces
- [ ] Fluxo do plugin:
  1. Empacota projeto KiCad (zip com .kicad_pcb, .kicad_sch, libs)
  2. Envia para API RouteAI
  3. Mostra progress dialog
  4. Exibe resultados como annotations no board do KiCad
  5. Cada annotation linkada ao item do review
- [ ] Annotations inline:
  - DRC violations como markers visuais na board
  - Tooltip com detalhes e sugestao ao hover
  - Double-click abre painel detalhado
- [ ] Autenticacao: login dialog + token storage seguro
- [ ] Distribuicao: KiCad Plugin Manager (PCM)
- [ ] Funciona offline: mostra aviso e sugere CLI para analise local

### Semana 15-16: Polish + Beta Fechado

#### S15-16.1: Design Review Intelligence

**Tarefas**:
- [ ] Categorias de review expandidas:
  - **DRC**: todas as violacoes com fix suggestions especificas
  - **Decoupling**: missing decaps, placement ruim (longe dos pins), valor incorreto
  - **Impedancia**: traces high-speed sem controle de impedancia, stackup inadequado
  - **Thermal**: traces com corrente insuficiente, thermal relief issues, heat dissipation
  - **Manufacturing**: trace/space abaixo do minimo do fab, drill too small, acid traps
  - **Placement**: componentes muito proximos para soldering, decaps longe dos IC pins
  - **High-Speed**: falta de length matching, diff pair routing issues, reference plane breaks
- [ ] Report export: PDF com screenshots do board, lista de issues, metricas
- [ ] Aprendizado: tracking de accept/reject para futuro RLHF

#### S15-16.2: Infraestrutura de Launch

**Tarefas**:
- [ ] Deploy em AWS (ECS ou Kubernetes simples):
  - API Gateway: 2x t3.medium
  - Intelligence: 1x c5.xlarge (LLM inference)
  - PostgreSQL: RDS db.t3.medium
  - Redis: ElastiCache t3.small
  - MinIO: S3 standard
- [ ] Monitoring: Prometheus + Grafana
  - Latencia da review (P50, P95, P99)
  - DRC accuracy vs KiCad
  - LLM response quality (confidence distribution)
  - User metrics (uploads, reviews, chat messages)
- [ ] Logging: structured JSON logs, ELK stack
- [ ] SSL/TLS, CORS, security headers
- [ ] Landing page + docs + onboarding tutorial
- [ ] Beta invite system (100 early adopters)

### Entregaveis Fase 1
- [x] Web app: upload KiCad/Eagle -> PCB viewer -> AI review -> chat
- [x] KiCad plugin nativo via PCM
- [x] DRC + LLM review com 7 categorias e citacoes
- [x] Chat conversacional com respostas grounded
- [x] Auth, billing, usage tracking
- [x] Deploy em producao com monitoring

### Metricas de Sucesso Fase 1
| Metrica | Target |
|---------|--------|
| DRC accuracy vs commercial | 98% |
| Design review accuracy | 85% acionavel |
| Hallucination rate (critical) | < 1% |
| Review latencia P95 | < 60s |
| NPS early adopters | > 40 |
| MAU | 500 |

---

## FASE 2: Intelligent Routing Engine (Semanas 17-28)

**Objetivo**: Diferencial core do produto. Auto-routing guiado por LLM que entende design intent e produz resultados production-quality.

**Time**: 3-4 engenheiros

### Semana 17-20: Routing Engine Core (C++)

#### S17-20.1: Infraestrutura do Router

**Tarefas**:
- [ ] Projeto C++17 com CMake + Conan:
  - Dependencias: Boost.Geometry, Clipper2, gRPC, protobuf, Eigen
  - Build targets: library (.so) + gRPC server + unit tests (GoogleTest)
- [ ] Grid model para routing:
  - Multi-layer grid com resolucao configuravel (default: 1mil)
  - Obstacle map gerado do board state (pads, vias, zones, keepouts, traces existentes)
  - Cost map por layer (congestion, preferencia de direcao)
- [ ] Interface gRPC:
  ```protobuf
  service RoutingService {
    rpc RouteNets(RoutingRequest) returns (stream RoutingProgress);
    rpc RouteInteractive(InteractiveRouteRequest) returns (RouteResult);
    rpc CancelRouting(CancelRequest) returns (CancelResponse);
  }
  ```
- [ ] Board representation eficiente em memoria:
  - Spatial index (R-tree) para queries geometricas
  - Net-based connectivity graph
  - Layer stack com cross-references

#### S17-20.2: Algoritmos de Routing V1 Core

**Tarefas**:
- [ ] **Lee/Maze Router**:
  - BFS no grid com obstaculos
  - Multi-layer com via insertion
  - Wavefront expansion com backtracing
  - Testes: single net, multi-obstacle, multi-layer
- [ ] **A* Router com Cost Map**:
  - Heuristica: Manhattan distance + congestion penalty + via penalty + layer change penalty
  - Cost map dynamico: atualiza apos cada net roteada
  - Preferencia de direcao por layer (H/V)
  - Testes: compare vs Lee em qualidade e velocidade
- [ ] **Rip-up & Reroute**:
  - Negociacao de conflitos entre nets
  - Pathfinder-based rip-up: cost escalation iterativo
  - Convergencia garantida com limit de iteracoes
  - Testes: nets conflitantes que requerem reordenamento
- [ ] **Global Router**:
  - Divide board em grid grosso (global cells)
  - Multicommodity flow para atribuicao de capacidade
  - Guia o detailed router para reducir congestion
  - Testes: boards com 500+ nets
- [ ] **Differential Pair Router**:
  - Routing acoplado mantendo gap constante
  - Impedancia controlada durante routing
  - Suporte edge-coupled e broadside-coupled
  - Phase tuning no final
  - Testes: DDR4 byte lanes, USB, Ethernet
- [ ] **Length Matching**:
  - Calculo de comprimento exato (incluindo arcos)
  - Insercao automatica de serpentina/trombone
  - Constraint propagation para grupos
  - Testes: DDR4 data groups, clock distribution

**Criterio de aceite**: 90% routing completion em boards 2-4 layers com ate 500 nets. P95 < 60s para 200 nets.

### Semana 21-24: LLM Routing Director + Integracao

#### S21-24.1: LLM como Diretor de Routing

**Tarefas**:
- [ ] System prompt de routing strategy:
  - Input: esquematico + board state + componentes posicionados + stackup + constraints
  - Output: `RoutingStrategy` JSON:
    ```json
    {
      "routing_order": [
        {"net": "DDR_DQ0", "priority": 1, "reason": "DDR4 data, length-critical"},
        {"net": "DDR_CLK", "priority": 2, "reason": "Clock, impedance-critical"}
      ],
      "layer_assignment": {
        "DDR_*": {"signal_layers": ["F.Cu", "In1.Cu"], "reason": "Adjacent to GND plane"},
        "POWER_*": {"signal_layers": ["In2.Cu", "B.Cu"], "reason": "Power near bottom plane"}
      },
      "via_strategy": {
        "high_speed": "through_only",
        "general": "through_or_blind"
      },
      "cost_weights": {
        "wire_length": 1.0,
        "via_count": 0.8,
        "congestion": 0.6,
        "layer_change": 0.5
      },
      "constraints_generated": [...]
    }
    ```
- [ ] Separacao clara de responsabilidades:
  - **LLM decide**: ordem de roteamento, layer assignment, via strategy, cost weights
  - **Solver executa**: pathfinding, via insertion, length equalization, DRC compliance
  - LLM NUNCA gera geometria diretamente
- [ ] Feedback loop:
  - Solver reporta resultado (completion %, DRC violations, congestion map)
  - LLM ajusta estrategia se necessario (max 3 iteracoes)
  - Se nao convergir: partial result + flag para engenheiro

#### S21-24.2: Interactive Routing no Frontend

**Tarefas**:
- [ ] Selecao de nets para routing:
  - Click em net no sidebar ou no board -> highlight
  - Multi-select com Ctrl/Shift
  - "Route selected" button
- [ ] Natural language input para constraints:
  - "Route this DDR4 byte lane with 50 ohm impedance, length-matched to +/-5mil"
  - Parser de NL -> structured constraints
- [ ] Visualizacao do routing em progresso:
  - Animacao de traces sendo roteadas
  - Progress bar: nets completed / total
  - Congestion heatmap em tempo real
- [ ] Review de resultado:
  - Visual diff: novas traces em verde
  - DRC report inline
  - Accept / Reject por net ou grupo
  - Undo completo (restore board state)
- [ ] Progressive routing:
  - Engenheiro roteia nets criticas manualmente (drag trace tool)
  - RouteAI roteia o resto automaticamente
  - Lock de traces manuais (nao sao rip-up candidates)

### Semana 25-26: Placement Optimizer

#### S25-26.1: Placement Algorithms

**Tarefas**:
- [ ] **Force-Directed Placement**:
  - Nets como molas entre componentes
  - Iteracao ate convergencia
  - Respeita board outline e keepouts
- [ ] **FM/KL Partitioning**:
  - Divide componentes em regioes
  - Minimiza nets cruzando particoes
  - Usado como pre-passo para force-directed
- [ ] **LLM-Guided Floorplanning**:
  - LLM analisa esquematico e sugere agrupamento:
    - "Power section: U1, L1, C1-C4 near input connector"
    - "DDR4: U2, R1-R8, C10-C25 grouped, short traces"
  - Gera initial placement zones
  - Solver otimiza dentro das zones

#### S25-26.2: Placement Interativo

**Tarefas**:
- [ ] Drag-and-drop de componentes no viewer
- [ ] Snap to grid configuravel
- [ ] Ratsnest dynamico (update em real-time ao mover)
- [ ] "Auto-place" button: LLM + solver posiciona automaticamente
- [ ] Placement suggestions: LLM sugere moves com rationale
  - "Move C5 closer to U1 pin 3 (decoupling, current datasheet recommends < 2mm)"

### Semana 27-28: DRC Engine v1 (C++ / Clipper2)

#### S27-28.1: Migration para C++

**Tarefas**:
- [ ] Reescrever DRC engine em C++ com Clipper2:
  - Polygon boolean operations exatas (nao aproximacoes)
  - Sub-millisecond clearance checks
  - Callable de Python via ctypes/pybind11
- [ ] DRC checks expandidos:
  - Acid trap detection
  - Copper sliver detection
  - Silk-to-pad clearance
  - Solder mask expansion validation
  - Paste mask aperture ratio
  - Drill-to-copper clearance
- [ ] High-speed DRC:
  - Impedance discontinuity detection (trace width changes, via transitions)
  - Stub length check
  - Differential pair uncoupled length
  - Reference plane violation detection (slot, split, no plane)
- [ ] Manufacturing DRC com perfis de fabricante:
  - JLCPCB capabilities (min trace, drill, etc.)
  - PCBWay capabilities
  - OSH Park capabilities
  - Custom fab profile input

**Criterio de aceite**: DRC 99.5%+ accuracy em boards 2-4 layers auto-roteadas. Latencia < 1s para board completa.

### Entregaveis Fase 2
- [x] Routing engine C++: Lee, A*, rip-up&reroute, global, diff pair, length match
- [x] LLM routing director com estrategia automatica
- [x] Interactive routing: select nets, NL constraints, visual diff, accept/reject
- [x] Placement optimizer: force-directed, FM/KL, LLM floorplanning
- [x] DRC engine C++ com Clipper2 (full IPC-2221B)
- [x] Progressive routing (manual + auto mixed)

### Metricas de Sucesso Fase 2
| Metrica | Target |
|---------|--------|
| Auto-route completion rate | 90% (2-4 layer) |
| DRC accuracy | 99.5% |
| Hallucination rate (critical) | < 0.1% |
| Routing latency P95 (200 nets) | < 60s |
| NPS | > 50 |
| MAU | 3,000 |
| Pro subscribers | 300 |

---

## FASE 3: Schematic Intelligence (Semanas 29-40)

**Objetivo**: Estender a plataforma upstream para design esquematico. O LLM auxilia em design de circuitos, selecao de componentes, e faz a ponte automatica esquematico -> layout.

**Time**: 4-5 engenheiros

### Semana 29-32: Schematic Editor Web

#### S29-32.1: Editor de Esquematicos

**Tarefas**:
- [ ] Canvas 2D para esquematicos (SVG ou Canvas2D):
  - Grid snap, zoom, pan
  - Symbols library (resistor, cap, IC, connector, etc.)
  - Wire drawing tool (click-click routing)
  - Net labels (local, global, hierarchical)
  - Bus notation
  - Power symbols (VCC, GND, 3V3, etc.)
  - Hierarchical sheets
- [ ] Component library browser:
  - Search por nome, categoria, parametros
  - Preview de symbol + footprint + datasheet link
  - Drag-and-drop para schematic
  - Integracao com LCSC, DigiKey, Mouser para disponibilidade/preco
- [ ] Property editor:
  - Editar value, footprint, custom fields
  - Bulk edit (selecionar multiplos componentes)
- [ ] Undo/redo stack ilimitado
- [ ] Keyboard shortcuts estilo KiCad

#### S29-32.2: LLM-Assisted Component Selection

**Tarefas**:
- [ ] Natural language component search:
  - "I need a 3.3V LDO, 500mA, SOT-23, under $0.50"
  - "Find me an IMU with accelerometer + gyroscope, SPI, LGA, automotive rated"
- [ ] Trade-off analysis:
  - LLM compara opcoes e explica trade-offs
  - Tabela comparativa com parametros relevantes
  - Recomendacao com rationale
- [ ] Circuito sugerido:
  - "Add a USB-C PD sink circuit"
  - LLM sugere componentes + esquematico + constraints
  - Engenheiro revisa e aceita/modifica

### Semana 33-36: Schematic-to-Constraints Pipeline

#### S33-36.1: Circuit Analysis via LLM

**Tarefas**:
- [ ] Identificacao de blocos funcionais:
  - Power supply (buck, boost, LDO, charge pump)
  - Digital core (MCU, FPGA, memory)
  - Analog front-end (ADC, DAC, op-amp, filters)
  - Communication interfaces (USB, Ethernet, SPI, I2C, UART, CAN)
  - RF (antenna matching, filters, PA/LNA)
- [ ] Classificacao automatica de nets:
  - Power nets, ground nets
  - Clock nets (frequencia detectada do circuito)
  - High-speed data (DDR, USB, Ethernet, PCIe)
  - Analog signals (low noise, high impedance)
  - Digital general purpose
- [ ] Design rule inference do esquematico:
  - Detecta DDR4 interface do SDRAM IC -> gera impedancia, length matching, spacing per JEDEC
  - Detecta USB 2.0/3.0 -> gera diff pair impedancia (90 ohm), length matching
  - Detecta buck converter -> gera current capacity, loop area constraints
  - Cada regra com citacao (datasheet, standard)

#### S33-36.2: BOM Validation & Schematic Review

**Tarefas**:
- [ ] BOM validation:
  - Cross-reference valores vs requisitos do circuito
  - Flag: cap dieletrico errado para decoupling (X7R vs Y5V)
  - Flag: voltage rating insuficiente
  - Flag: thermal derating concerns
  - Flag: componente obsolete/NRND
  - Alternativas sugeridas quando issues encontrados
- [ ] Schematic review automatica:
  - Missing pull-ups em open-drain
  - Missing decoupling caps
  - ESD protection gaps
  - Crystal load capacitor values incorretos
  - Bypass caps muito longe dos IC pins (cross-ref com layout se disponivel)
  - Missing series resistors em outputs
  - Power sequencing issues

### Semana 37-40: Design Intent Capture + Integracao

#### S37-40.1: Design Intent

**Tarefas**:
- [ ] Anotacoes de bloco no esquematico:
  - Engenheiro marca bloco e descreve intent:
    - "This is a 1GHz clock distribution network"
    - "This power section handles 5A continuous"
    - "Low-noise analog input, 16-bit resolution"
  - RouteAI propaga constraints para layout automaticamente
- [ ] Constraint propagation automatica:
  - Esquematico -> net classes, impedancias, length groups, placement groups
  - Engenheiro revisa constraints antes de routing
  - Modificacoes no esquematico atualizam constraints automaticamente

#### S37-40.2: Schematic <-> Layout Sync

**Tarefas**:
- [ ] Forward annotation: mudancas no esquematico refletidas no layout
- [ ] Back annotation: pin swaps e gate swaps no layout refletidos no esquematico
- [ ] Cross-probe: click no componente no schematic -> highlight no layout e vice-versa
- [ ] Netlist diff: visual diff quando esquematico muda

### Entregaveis Fase 3
- [x] Editor de esquematicos web com library browser
- [x] LLM-assisted component selection com trade-off analysis
- [x] Circuit analysis automatica (blocos, net classification)
- [x] Design rule inference do esquematico
- [x] BOM validation e schematic review
- [x] Design intent capture e constraint propagation
- [x] Schematic <-> layout sync bidirecional

### Metricas de Sucesso Fase 3
| Metrica | Target |
|---------|--------|
| Design review accuracy | 92% acionavel |
| Constraint inference accuracy | 95% vs manual |
| Component suggestion relevance | 90% aceitos |
| MAU | 8,000 |
| Pro subscribers | 800 |
| MRR | $57K |

---

## FASE 4: Production Platform (Semanas 41-56)

**Objetivo**: Plataforma enterprise-ready com SI/PI avancado, colaboracao multi-usuario, manufacturing output completo.

**Time**: 5-6 engenheiros

### Semana 41-44: SI/PI Engine

#### S41-44.1: Signal Integrity

**Tarefas**:
- [ ] Impedance control engine:
  - Closed-form: microstrip (Hammerstad-Jensen), stripline (IPC-2141)
  - 2D field solver (OpenEMS) para validacao e geometrias complexas
  - Coplanar waveguide, coplanar with ground
  - Report: impedancia por net vs target, desvio %
- [ ] Crosstalk analysis:
  - FEXT/NEXT calculation per IPC-2141
  - Coupled transmission line model
  - Heatmap de crosstalk no board
  - Sugestoes de mitigacao (spacing, guard traces)
- [ ] Return path analysis:
  - Verificacao de continuidade do plano de referencia
  - Deteccao de slots e splits sob traces high-speed
  - Via transition analysis (mudanca de plano de referencia)
  - Sugestoes de stitching vias
- [ ] PDN analysis:
  - AC impedance da power distribution network
  - Decoupling capacitor optimization (valor, quantidade, posicao)
  - Target impedance calculation
  - Frequency domain plot

#### S41-44.2: Power Integrity

**Tarefas**:
- [ ] IR drop analysis:
  - DC resistance calculation das power planes/traces
  - Current density heatmap
  - Voltage drop por componente
- [ ] Copper pour analysis:
  - Fill quality assessment
  - Thermal relief effectiveness
  - Heat spreading calculation

### Semana 45-48: Colaboracao Multi-Usuario

#### S45-48.1: Real-Time Co-Editing

**Tarefas**:
- [ ] CRDT-based collaboration (Yjs ou similar):
  - Multiplos usuarios editando o mesmo board
  - Cursor awareness (ver cursor dos outros)
  - Conflict resolution automatica
- [ ] Design versioning:
  - Git-like branching model para designs
  - Branch, commit, merge, diff de designs
  - Visual diff: overlay de duas versoes com diferencas highlighted
- [ ] Review workflow:
  - Assign reviewer
  - Comment inline no board (pin comment a location)
  - Approval gates (min N approvers)
  - Merge com checklist (DRC pass, review approved)

#### S45-48.2: Team Features

**Tarefas**:
- [ ] Shared component libraries (team-wide)
- [ ] Design templates (start from template)
- [ ] Activity feed (quem mudou o que quando)
- [ ] Role-based access control (admin, editor, viewer)
- [ ] Shared design rules (team standards)

### Semana 49-52: Manufacturing Output

#### S49-52.1: Gerber & Fabrication

**Tarefas**:
- [ ] Gerber RS-274X export:
  - Todas as layers: copper, mask, silk, paste, outline, drill
  - Aperture list
  - Compativel com viewers (GerbView, Tracespace)
- [ ] Excellon drill file export
- [ ] IPC-2581 export (single-file manufacturing data)
- [ ] ODB++ export
- [ ] Pick-and-place file (component positions, rotations)
- [ ] BOM export com links de suppliers:
  - CSV, Excel, JSON
  - DigiKey, Mouser, LCSC links diretos
  - Pricing por quantidade
  - Alternativas sugeridas para out-of-stock
- [ ] DFM analysis por fabricante:
  - Verificar design vs capabilities especificas do fab
  - JLCPCB, PCBWay, OSH Park, Eurocircuits
  - Report com issues e sugestoes de fix
  - One-click order (redirect para fab com files prontos)

#### S49-52.2: Integracao com Fabricantes

**Tarefas**:
- [ ] API integration com JLCPCB:
  - Quote automatico baseado no design
  - Validacao DFM contra capabilities reais
  - Upload direto para order
- [ ] API integration com PCBWay
- [ ] API integration com OSH Park

### Semana 53-56: Enterprise Features + Launch

#### S53-56.1: Enterprise Security & Compliance

**Tarefas**:
- [ ] SSO/SAML integration (Okta, Azure AD, Google Workspace)
- [ ] Audit logging completo (quem fez o que quando)
- [ ] End-to-end encryption de designs (AES-256 at rest, TLS 1.3 in transit)
- [ ] SOC 2 Type II preparation
- [ ] Data residency controls (designs nunca saem da regiao)
- [ ] IP protection policy: designs NUNCA usados para training
- [ ] On-premise deployment option (Kubernetes + Helm chart)
- [ ] Air-gapped mode com LLM local (Llama/Mistral fine-tuned)

#### S53-56.2: Compliance Reporting

**Tarefas**:
- [ ] IPC Class 2/3 compliance verification
- [ ] Checklist de compliance por standard:
  - IPC-2221B (generic)
  - IPC-6012 (rigid board qualification)
  - IPC-A-610 (acceptability of assemblies)
- [ ] Export de compliance report (PDF)

#### S53-56.3: Performance & Scale

**Tarefas**:
- [ ] Load testing: 10,000 concurrent users, 100 concurrent routing jobs
- [ ] CDN para assets estaticos (component 3D models, fonts, etc.)
- [ ] Auto-scaling policies:
  - API pods: scale on CPU/memory + request count
  - Router workers: scale on queue depth
  - GPU nodes: scale on simulation queue, spot instances
- [ ] Multi-region: US-East primary, AP-Southeast quando > 20% traffic asiatico
- [ ] Database: read replicas, connection pooling (PgBouncer)
- [ ] Caching strategy:
  - Redis: session, rate limit, component search results
  - CDN: static assets, reference design thumbnails
  - LLM cache: common patterns (impedance queries, standard clearances)

### Entregaveis Fase 4
- [x] SI/PI engine: impedancia, crosstalk, PDN, return path, IR drop
- [x] Colaboracao real-time com CRDT + design versioning
- [x] Manufacturing output completo (Gerber, Excellon, IPC-2581, ODB++, BOM, PnP)
- [x] DFM analysis por fabricante + integracao direta
- [x] Enterprise: SSO, audit, encryption, on-premise, air-gapped
- [x] IPC compliance reporting
- [x] Escala: 10K users, 100 routing jobs, multi-region

### Metricas de Sucesso Fase 4
| Metrica | Target |
|---------|--------|
| DRC accuracy | 99.9% |
| Auto-route completion | 95% (6-8 layer) |
| Hallucination rate (critical) | 0% |
| Routing latency P95 (1000 nets) | < 120s |
| SI accuracy vs HFSS | +/-5% |
| NPS | > 60 |
| MAU | 15,000 |
| Paid conversion | 5% |
| MRR | $122K |

---

## Stack Tecnologico Completo

### Core

| Componente        | Tecnologia            | Justificativa                                                |
|-------------------|-----------------------|--------------------------------------------------------------|
| Frontend          | React + Three.js      | WebGL para PCB rendering GPU-accelerated                     |
| API Gateway       | Go (Gin)              | Baixa latencia, concorrencia excelente para WebSocket        |
| LLM Orchestration | Python (FastAPI)      | Ecossistema ML/AI, LangChain, asyncio                       |
| Routing Engine    | C++17                 | Performance critica, Boost.Geometry, Eigen                   |
| DRC Engine        | C++ (Clipper2)        | Polygon booleans exatas, sub-millisecond                     |
| SI/PI Engine      | Python + OpenEMS      | FDTD open-source, closed-form para real-time                 |
| Constraint Solver | Z3 (Python bindings)  | SMT solver formal, garante corretude de length/timing        |
| Database          | PostgreSQL+PostGIS    | Spatial queries, pgvector para RAG, JSONB flexivel           |
| Job Queue         | Temporal.io           | Workflows duraveis, retry, cancellation, visibility          |
| File Storage      | MinIO (S3)            | Self-hosted ou cloud, versioned                              |
| Cache             | Redis                 | Session, rate limit, hot data                                |
| Infrastructure    | Kubernetes            | Scaling independente de routing/LLM/web                      |
| LLM Provider      | Claude API (Anthropic) | Melhor reasoning para engineering, tool-calling              |

### Toolchain

| Categoria     | Ferramenta                  | Uso                                           |
|---------------|-----------------------------|-----------------------------------------------|
| VCS           | Git + GitHub                | Monorepo, PR-based workflow, CI gates          |
| CI/CD         | GitHub Actions              | Build, test, lint, nightly benchmarks          |
| C++ Build     | CMake + Ninja + Conan       | Cross-platform, dependency management          |
| Python Build  | Poetry + Ruff + mypy        | Type checking strict, linting, reproducible    |
| Testing       | GoogleTest, pytest, Playwright | C++ unit, Python integration, E2E browser   |
| Monitoring    | Prometheus + Grafana        | Latencia, accuracy, quality, throughput        |

---

## Modelo de Negocio

### Pricing Tiers

| Tier       | Preco         | Features                                                          | Target                  |
|------------|---------------|-------------------------------------------------------------------|-------------------------|
| Community  | Free          | 2-layer, 50 nets, 5 AI reviews/mes, KiCad only, DRC basico       | Estudantes, hobbyists   |
| Pro        | $49/mes       | 4-layer, 500 nets, reviews ilimitados, auto-routing, KiCad+Eagle  | Freelancers, indie HW   |
| Team       | $149/seat/mes | 8+ layers, nets ilimitados, SI/PI, todos os formatos, colaboracao | Startups, times pequenos|
| Enterprise | Custom        | On-premise, SSO/SAML, audit, SLA, model custom, air-gapped       | Auto, aero, medical     |

### Projecoes de Receita

| Metrica          | Mes 6  | Mes 12  | Mes 18  | Mes 24   | Mes 36   |
|------------------|--------|---------|---------|----------|----------|
| Free users       | 2,000  | 8,000   | 20,000  | 40,000   | 100,000  |
| Pro subscribers  | 50     | 300     | 800     | 1,500    | 4,000    |
| Team seats       | 0      | 20      | 100     | 300      | 1,000    |
| Enterprise       | 0      | 0       | 2       | 5        | 15       |
| MRR              | $2.5K  | $18K    | $57K    | $122K    | $380K    |

### Go-to-Market

1. **Meses 1-6: Community-Led Growth**
   - KiCad plugin no PCM (Plugin & Content Manager)
   - Forum KiCad, tutoriais, sponsor KiCon
   - Blog tecnico (PCB best practices)
   - YouTube tutorials com workflow AI-assisted
   - Library de reference designs AI-reviewed (Arduino shields, RPi HATs, power supplies)

2. **Meses 6-12: Product-Led Growth**
   - Free tier com upgrade triggers naturais (hit layer/net limits em projetos reais)
   - In-app suggestions: "This 4-layer design would benefit from Pro impedance analysis"
   - Parcerias com fabricantes (JLCPCB, PCBWay, OSH Park) para DFM checks integrados

3. **Meses 12-24: Enterprise Expansion**
   - Validacao automotive (AEC-Q100), medical (IPC-A-610 Class 3), aerospace
   - SI/PI como alternativa a Cadence/Ansys ($50K+ seat) a 10% do custo
   - Compliance reports para industrias reguladas

---

## Riscos e Mitigacoes

| ID  | Risco                                                 | Severidade | Mitigacao                                                                                             |
|-----|-------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------|
| R1  | LLM hallucina em clearance/creepage safety-critical   | Critico    | Pipeline 3-gates. Physics engine verifica. Constitutional AI. Zero tolerance: rejeicao automatica     |
| R2  | Routing engine falha em boards complexos              | Alto       | Progressive completion: roteia 95%+ e flag restante. Timeout com resultados parciais                  |
| R3  | CAD parser quebra em edge cases                       | Alto       | Suite de testes de comunidade. Fuzzing. Degradacao graciosa: parse parcial com warnings               |
| R4  | Custo da API LLM inviabiliza unit economics           | Medio      | Modelo tiered (barato para simples, Claude para complexo). Cache agressivo. Fine-tune menor           |
| R5  | Enterprise exige on-premise                           | Medio      | Kubernetes desde dia 1. Air-gapped com LLM local (Llama/Mistral fine-tuned)                          |
| R6  | EDA incumbents lancam AI features                     | Alto       | Velocidade > corporate R&D. Multi-CAD (incumbents locked). Community-first = lealdade                |
| R7  | Preocupacoes de IP (upload de designs para cloud)     | Alto       | E2E encryption. SOC2 Type II. On-premise option. Designs NUNCA usados para training                  |
| R8  | Resistencia de engenheiros experientes                | Medio      | Posicionar como augmentation, nao replacement. Comecar com review (nao-ameacador). Transparencia      |

---

## Time e Crescimento

### Fase 0-1 (Core Team: 1-3 pessoas)

| Papel                  | Skills Chave                                    | Responsabilidade                              |
|------------------------|-------------------------------------------------|-----------------------------------------------|
| Founder / Tech Lead    | Embedded, PCB design, C/C++, arquitetura        | Visao, arquitetura, routing engine, dominio   |
| Full-Stack Engineer    | React, WebGL, Go, PostgreSQL                    | Web platform, PCB viewer, API, database       |
| ML/AI Engineer         | LLM fine-tuning, RAG, Python, prompt eng.       | LLM agent, RAG pipeline, anti-hallucination   |

### Fase 2-4 (Expansao: 4-6 pessoas)

| Papel                  | Skills Chave                                    | Responsabilidade                              |
|------------------------|-------------------------------------------------|-----------------------------------------------|
| EDA Algorithm Engineer | PhD EDA/VLSI, C++, algorithms                   | Routing, placement, formal verification       |
| SI/PI Engineer         | Signal integrity, EM simulation                 | Impedancia, crosstalk, PDN, validacao         |
| DevOps/Platform        | Kubernetes, CI/CD, monitoring                   | Infra scaling, deployment, observability      |
| Product Designer       | UX para tools tecnicas                          | PCB viewer UX, chat, review workflow          |

---

## Estrategia de Especializacao do LLM

### Evolucao Progressiva (4 Estagios)

| Estagio | Descricao                                | Quando                    | Dados Necessarios              |
|---------|------------------------------------------|---------------------------|--------------------------------|
| 1       | Curated training data                    | Fase 0-1                  | 50K+ PCB designs com DRC/SI    |
| 2       | Tool-use fine-tuning                     | Fase 1-2                  | Training pairs (context, tool_call, result) |
| 3       | RLHF com feedback de engenheiro          | Fase 2+ (beta users)      | Accept/reject signals em producao |
| 4       | Constitutional AI para EDA               | Fase 3+                   | Hard constraints formalizadas  |

**Stage 1**: Coletar 50K+ PCB designs com DRC reports, SI analysis, e review comments. Construir dataset de instruction-tuning: (design_context, correct_action) pairs.

**Stage 2**: Treinar modelo para invocar DRC engine, impedance calculator, e constraint solver como tools de forma confiavel, interpretando resultados corretamente.

**Stage 3**: Deploy para beta users, coletar sinais de accept/reject nas sugestoes, usar como reward signal para reinforcement learning.

**Stage 4**: Embutir hard constraints (ex: nunca sugerir clearance abaixo do minimo IPC Class 2, nunca rotear diff pairs high-speed sem reference plane) como principios constitucionais que sobrepoe a geracao.

---

## Scalability Architecture

### 3 Perfis de Compute Independentes

```
┌─────────────────────────────────────────────────┐
│  INTERACTIVE (<500ms, 10K concurrent users)     │
│  Board viewing, DRC single-net, chat, constraints│
│  → Go API pods, Redis cache, horizontal scale   │
├─────────────────────────────────────────────────┤
│  ROUTING JOBS (seconds-minutes, 100 concurrent) │
│  Full board routing, placement, batch DRC        │
│  → C++ worker pods, Temporal queue, auto-scale  │
├─────────────────────────────────────────────────┤
│  SIMULATION (GPU, minutes-hours, 20 concurrent) │
│  SI/PI field solver, thermal, EMI               │
│  → GPU node pool, spot instances, cost-optimized│
└─────────────────────────────────────────────────┘
```

### Storage Estimates
- Design medio: ~50MB
- 20K designs = ~1TB hot storage
- Component library: 500K+ entries, CDN para assets (3D models, datasheets)
- RAG: 1M+ embeddings em pgvector, sharded por dominio

---

## Calendario Resumido

```
Semana  1-6  ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  FASE 0: Foundation
Semana  7-16 ░░░░░░██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  FASE 1: Design Review (MVP)
Semana 17-28 ░░░░░░░░░░░░░░░░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  FASE 2: Routing Engine
Semana 29-40 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████░░░░░░░░░░░░░░░░  FASE 3: Schematic Intelligence
Semana 41-56 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████  FASE 4: Production Platform
```

**Total: 56 semanas (~14 meses)**

**Marcos chave**:
- Semana 6: CLI funcional (valida viabilidade tecnica)
- Semana 16: MVP web + KiCad plugin (primeiros usuarios reais)
- Semana 28: Auto-routing funcional (diferencial competitivo ativado)
- Semana 40: End-to-end schematic-to-layout (plataforma completa)
- Semana 56: Enterprise-ready, multi-region, production-grade
