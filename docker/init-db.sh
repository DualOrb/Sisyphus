#!/bin/bash
# Create the langfuse database if it doesn't exist.
# Runs on first Postgres boot via /docker-entrypoint-initdb.d/.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    SELECT 'CREATE DATABASE langfuse'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'langfuse')\gexec
EOSQL
