# ---------------------------------------------------------------------------
# The courier module runs as part of the Inaaya Commerce Platform: the stack is
# the repository root's docker-compose.yml (database, both modules, gateway).
# These targets drive that stack from here, plus the module's own tooling.
#
# BuildKit cannot read the reparse points that OneDrive's Files On-Demand puts
# on every file; if this checkout sits in a OneDrive folder, keep the two
# variables below (the legacy builder handles them). Outside OneDrive they can go.
# ---------------------------------------------------------------------------
export DOCKER_BUILDKIT = 0
export COMPOSE_DOCKER_CLI_BUILD = 0

COMPOSE = docker compose -f ../../docker-compose.yml --project-directory ../..

.PHONY: dev up down logs migrate seed test bench clean types samples

dev: up

up:
	$(COMPOSE) up --build -d
	@echo "platform -> http://localhost:5080"

down:
	$(COMPOSE) down

clean:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f --tail=100 courier-api courier-web

migrate:
	cd backend && alembic upgrade head

seed:
	cd backend && python -m app.db.seed

test:
	cd backend && pytest -q

bench:
	cd backend && python -m tests.bench_500

types:
	python scripts/gen_types.py

samples:
	python scripts/make_samples.py
