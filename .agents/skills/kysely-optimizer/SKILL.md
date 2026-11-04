---
name: kysely-optimizer
description: Inspects database queries to verify pure Kysely compliance. Prevents raw strings, optimizes joins, and ensures type checking against the master database schema.
---

# Kysely DB Query Optimization Protocol

When processing database or repository layers, strictly audit the database operations using these benchmarks:

## 1. Structural Kysely Evaluation
- Intercept and block any attempts to construct Prisma, TypeORM, or unparameterized string queries.
- Ensure queries leverage Kysely's fluid builder methods (`selectFrom`, `innerJoin`, `where`, `orderBy`).
- If raw SQL expressions are unavoidable, strictly require Kysely's `sql` tagged template literal with bound parameters.

## 2. Query Guardrails & Performance
- Confirm all query inputs use parameterized constraints to eliminate SQL injection vulnerabilities.
- Ensure transaction handlers (`db.transaction().execute(async (trx) => ...)`) are used for multi-step updates.
- Avoid unconstrained `selectAll()` on large tables; enforce explicit column selection and limit/offset pagination.
