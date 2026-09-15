# ---------------------------------------------------------------------------
# BuildKit cannot read the reparse points that OneDrive's Files On-Demand puts
# on every file, and this project is delivered inside a OneDrive-synced folder:
#
#   #5 ERROR: invalid file request alembic/env.py
#
# The legacy builder walks the context differently and handles them, so it is
# selected here.  Outside OneDrive you can drop both variables and use BuildKit.
# See docs/VERIFICATION.md -> "Known environment issue".
# ---------------------------------------------------------------------------
export DOCKER_BUILDKIT = 0
export COMPOSE_DOCKER_CLI_BUILD = 0

.PHONY: dev up down logs migrate seed test bench clean types samples

dev: up

up:
	docker compose up --build -d
	@echo "web  -> http://localhost:3000"
	@echo "api  -> http://localhost:8000/docs"

down:
	docker compose down

clean:
	docker compose down -v

logs:
	docker compose logs -f --tail=100

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
