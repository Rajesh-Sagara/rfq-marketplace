CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer','supplier')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfqs (
  id SERIAL PRIMARY KEY,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  delivery_location TEXT NOT NULL,
  deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  delivery_time TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);
