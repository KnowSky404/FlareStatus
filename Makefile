.PHONY: up up-probe down down-probe build build-probe restart restart-probe logs logs-probe ps config config-probe test typecheck

COMPOSE_CORE=docker compose -f docker-compose.yml
COMPOSE_PROBE=docker compose -f docker-compose.yml -f docker-compose.probe.yml

up:
	$(COMPOSE_CORE) up -d --build

up-probe:
	$(COMPOSE_PROBE) up -d --build

down:
	$(COMPOSE_CORE) down

down-probe:
	$(COMPOSE_PROBE) down

build:
	$(COMPOSE_CORE) build

build-probe:
	$(COMPOSE_PROBE) build

restart:
	$(COMPOSE_CORE) up -d --build

restart-probe:
	$(COMPOSE_PROBE) up -d --build

logs:
	$(COMPOSE_CORE) logs -f --tail=200

logs-probe:
	$(COMPOSE_PROBE) logs -f --tail=200

ps:
	$(COMPOSE_CORE) ps

config:
	$(COMPOSE_CORE) config

config-probe:
	$(COMPOSE_PROBE) config

test:
	bun run test

typecheck:
	bun run typecheck
