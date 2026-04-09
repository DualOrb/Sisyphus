#!/bin/bash
# Run shadow-live with a clean slate
lsof -ti:3000 | xargs kill -9 2>/dev/null
docker compose -f docker/docker-compose.yml exec redis redis-cli FLUSHALL 2>/dev/null
rm -f reports/shadow-live-*.md
rm -rf reports/cycles
npx tsx scripts/shadow-live.ts
