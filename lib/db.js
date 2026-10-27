// Conexión a Postgres (Neon en producción). Las tablas se crean solas la primera vez.
import pg from "pg";

let pool;
let ready;

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("Falta DATABASE_URL: conecta la base de datos Neon en Vercel.");
    pool = new pg.Pool({
      connectionString: url,
      max: 3,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

const SCHEMA = `
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists files (
  key text primary key,
  url text not null,
  mime text,
  size integer,
  scope text not null default 'public',
  created_at timestamptz not null default now()
);
create sequence if not exists order_seq start 1001;
create table if not exists orders (
  ref text primary key,
  seq integer not null,
  status text not null default 'pendiente_pago',
  paid boolean not null default false,
  total numeric(10,2) not null,
  email text not null,
  client text,
  pay text,
  redsys_order text unique,
  redsys_attempts integer not null default 0,
  redsys_result jsonb,
  price_check jsonb,
  data jsonb not null,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create table if not exists quotes (
  ref text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists users (
  email text primary key,
  client_key text not null,
  name text,
  pass_hash text not null,
  updated_at timestamptz not null default now()
);
create table if not exists login_attempts (
  id bigserial primary key,
  ip text,
  email text,
  at timestamptz not null default now()
);
`;

export async function db() {
  const p = getPool();
  if (!ready) ready = p.query(SCHEMA).catch((e) => { ready = null; throw e; });
  await ready;
  return p;
}

export async function q(text, params) {
  const p = await db();
  return p.query(text, params);
}
