import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// A product covered by a given lab report (derived from products.coa_url).
interface CoveredProduct {
  id: string;
  name: string;
  slug: string | null;
  strength: string | null;
  category: string | null;
  image_url: string | null;
  box_image_url: string | null;
}

/**
 * Public lab-results feed. Returns each analytical report joined with the
 * products it covers. Reports are shared across strengths (e.g. DSIP
 * 5/10/15mg), so covered products are matched by report_url ∈ products.coa_url
 * rather than a stored foreign key.
 */
export async function GET() {
  try {
    const [{ data: labResults, error: labError }, { data: products, error: productError }] =
      await Promise.all([
        supabase
          .from('lab_results')
          .select('*')
          .eq('active', true)
          .order('report_date', { ascending: false })
          .order('product_name', { ascending: true }),
        supabase
          .from('products')
          .select('id, name, slug, strength, category, image_url, box_image_url, coa_url')
          .eq('active', true)
          .not('coa_url', 'is', null),
      ]);

    if (labError) {
      console.error('Error fetching lab results:', labError);
      return NextResponse.json({ error: labError.message }, { status: 500 });
    }
    if (productError) {
      console.error('Error fetching products for lab results:', productError);
      return NextResponse.json({ error: productError.message }, { status: 500 });
    }

    // Index products by each COA url they reference so we can attach the full
    // set of covered strengths to every report in one pass.
    const productsByCoa = new Map<string, CoveredProduct[]>();
    for (const p of products ?? []) {
      for (const url of (p.coa_url as string[] | null) ?? []) {
        const list = productsByCoa.get(url) ?? [];
        list.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          strength: p.strength,
          category: p.category,
          image_url: p.image_url,
          box_image_url: p.box_image_url,
        });
        productsByCoa.set(url, list);
      }
    }

    const results = (labResults ?? []).map((lab) => {
      const covered = (productsByCoa.get(lab.report_url) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      return { ...lab, products: covered };
    });

    return NextResponse.json({ labResults: results });
  } catch (error) {
    console.error('Unexpected error in lab-results route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
