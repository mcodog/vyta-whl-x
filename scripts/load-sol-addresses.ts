import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  'https://swpcvpkcfxihxmjpjqow.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3cGN2cGtjZnhpaHhtanBqcW93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzQ4MTM1MSwiZXhwIjoyMDc5MDU3MzUxfQ.N9QjRH4xs27BUNL1G_JsxMsXkpz3nGoeI8CABzdnvAo'
);

async function load() {
  const raw = readFileSync(join(__dirname, 'sol_addresses.json'), 'utf-8');
  const addresses: { address: string; derivation_index: number }[] = JSON.parse(raw);

  console.log(`Loading ${addresses.length} SOL addresses...`);

  const BATCH = 500;
  let loaded = 0;

  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH).map(a => ({
      address: a.address,
      derivation_index: a.derivation_index,
      used: false,
    }));

    const { error } = await supabase.from('sol_addresses').insert(batch);
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed:`, error.message);
      // If duplicate, skip and continue
      if (error.message.includes('duplicate')) {
        console.log('  (skipping duplicates)');
        loaded += batch.length;
        continue;
      }
      process.exit(1);
    }
    loaded += batch.length;
    console.log(`  ${loaded} / ${addresses.length}`);
  }

  console.log('Done!');
}

load();
