create table if not exists public.products (
  id text primary key,
  name text not null check (char_length(name) <= 80),
  category text not null check (char_length(category) <= 40),
  price numeric(12, 0) not null check (price >= 0),
  image text not null,
  color text not null check (char_length(color) <= 40),
  stock integer not null check (stock >= 0 and stock <= 100000),
  description text not null check (char_length(description) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.seller_users (
  username text primary key,
  role text not null default 'seller',
  password_hash text not null,
  created_at timestamptz not null default now()
);

insert into public.seller_users (username, role, password_hash)
values (
  'seller',
  'seller',
  'f34b149fb879332dbd887db3da3538a4:569e067c6c3e91f4e5b4eb2db172fb9ed3fd694f919dbb6af7d9e5ea40c5e1970054ce8b8980315993bf3612654d66bea9fe7ade584558e84cc1aed108c739ad'
)
on conflict (username) do update
set role = excluded.role,
    password_hash = excluded.password_hash;

insert into public.products (id, name, category, price, image, color, stock, description)
values
  (
    'prod-checked-shirt',
    'Checked Casual Shirt',
    'Casual Shirt',
    2499,
    'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=900&q=80',
    'Navy Blue',
    8,
    'Soft checked casual shirt designed for daily wear, college style, and relaxed weekend outings.'
  ),
  (
    'prod-cotton-tee',
    'Urban Cotton T-Shirt',
    'T-Shirt',
    3199,
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
    'Olive Green',
    5,
    'Comfortable cotton T-shirt for everyday casual styling with a clean fit and easy feel.'
  ),
  (
    'prod-blue-jeans',
    'Classic Blue Jeans',
    'Jeans',
    1299,
    'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80',
    'Denim Blue',
    14,
    'Daily wear denim jeans with a neat modern fit, ideal for casual outings and regular use.'
  )
on conflict (id) do update
set name = excluded.name,
    category = excluded.category,
    price = excluded.price,
    image = excluded.image,
    color = excluded.color,
    stock = excluded.stock,
    description = excluded.description;
