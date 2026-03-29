# RouteAI - LLM-Powered EDA Platform for PCB Design

## Project Structure
Monorepo with packages: core (data model), parsers (KiCad/Eagle), intelligence (LLM agent), solver (DRC/physics), api (Go gateway), web (React frontend), router (C++ routing engine)

## Tech Stack
- Python packages: Poetry, Pydantic v2, FastAPI, LangChain, Shapely, z3-solver
- Go: Gin framework for API gateway
- C++17: CMake + Conan for routing engine
- Frontend: React + Three.js
- DB: PostgreSQL + PostGIS + pgvector
- Queue: Temporal.io
- Storage: MinIO (S3)
- LLM: Claude API (Anthropic)

## Development Commands
- `make dev` - Start dev environment (docker-compose up)
- `make test` - Run all tests
- `make lint` - Run linting (ruff + mypy)
- `make benchmark` - Run benchmarks
- `cd packages/core && poetry run pytest` - Test core package
- `cd packages/parsers && poetry run pytest` - Test parsers
- `cd packages/intelligence && poetry run pytest` - Test intelligence
- `cd packages/solver && poetry run pytest` - Test solver

## Conventions
- Python: ruff for formatting/linting, mypy strict for type checking
- All PCB data goes through the Unified Data Model (packages/core)
- LLM outputs are ALWAYS validated through 3-gate pipeline before use
- Tests required for all new code, target 80%+ coverage
