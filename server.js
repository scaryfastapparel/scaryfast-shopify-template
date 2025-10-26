/**
 * Scary Fast - Shopify <> OpenAI Integration Template
 * - Generates product metadata via OpenAI
 * - Creates products in Shopify via Admin REST API
 *
 * Usage:
 * 1) Fill .env with keys and shop info
 * 2) npm install
 * 3) npm start
 *
 * Endpoints:
 * - POST /generate-product   -> generate a single product (OpenAI only)
 * - POST /create-product     -> create given product in Shopify
 * - POST /generate-and-create -> generate (OpenAI) + create (Shopify)
 * - POST /bulk-generate      -> generate N products and create them (demo 20)
 */

import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import bodyParser from 'body-parser';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHOP = process.env.SHOPIFY_SHOP; // e.g., my-shop.myshopify.com
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

if (!SHOP || !SHOPIFY_TOKEN || !process.env.OPENAI_API_KEY) {
  console.error('Missing SHOPIFY / OPENAI env vars. Fill .env and restart.');
  process.exit(1);
}

/* --------- Pricing helper --------- */
function computeRetailPrice(cost, { inflationRate=0.05, taxRate=0.07, margin=0.35 } = {}) {
  // cost = base cost (e.g., Printify base); ensure retail covers base + inflation + tax + margin
  const costWithInflation = cost * (1 + inflationRate);
  const markup = costWithInflation * margin;
  const preTax = costWithInflation + markup;
  const retail = preTax * (1 + taxRate);
  // round to .99 style or nearest whole
  return Math.round(retail * 100) / 100;
}
// ---- Printify Helper ----
async function createPrintifyMockup(title, description, imageUrl) {
  try {
    // Get first connected shop
    const shopResp = await axios.get("https://api.printify.com/v1/shops.json", {
      headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}` }
    });
    const shopId = shopResp.data?.[0]?.id;
    if (!shopId) throw new Error("No Printify shop found.");

    // Create a simple T-shirt product in Printify (blueprint 6 = men's tee, provider 1 = Monster Digital)
    const payload = {
      title,
      description,
      blueprint_id: 6,
      print_provider_id: 1,
      variants: [{ id: 4012, price: 1999, is_enabled: true }],
      print_areas: [
        {
          variant_ids: [4012],
          placeholders: [
            {
              position: "front",
              images: [{ url: imageUrl }]
            }
          ]
        }
      ],
      visible: false
    };

    const createResp = await axios.post(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const mockupImg = createResp.data?.images?.[0]?.src;
    return mockupImg || null;
  } catch (err) {
    console.error("Printify error:", err.response?.data || err.message);
    return null;
  }
}

/* --------- OpenAI: generate structured product JSON --------- */
async function generateProductViaOpenAI(promptSeed, options={}) {
  // promptSeed: {brand, theme, product_type, style_notes} - we'll create a prompt to request JSON
  const prompt = `
You are an e-commerce product writer helping a Shopify brand "Scary Fast". Output a JSON object with keys:
"title", "short_description", "long_description", "price_base" (suggested Printify base cost in USD),
"recommended_price" (retail price suggested), "tags" (array), "printify_base_product" (string), "mockup_notes" (string), "variant_options" (array of variant objects like {option1: "size", values: ["S","M"...]}).

Seed info:
${JSON.stringify(promptSeed)}

Return only valid JSON. Keep prices realistic for POD apparel in USD.
  `;

  // Use the OpenAI chat/completions API (chatCompletion)
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",   // replace with the preferred model available on your account
    messages: [
      { role: "system", content: "You are an expert ecommerce product copywriter and pricing analyst." },
      { role: "user", content: prompt }
    ],
    max_tokens: 700,
    temperature: 0.25
  });

  const text = response.choices?.[0]?.message?.content || response.choices?.[0]?.text;
  // Basic safety: attempt JSON.parse, if fails, attempt extraction
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch (err) {
    // fallback: try to extract JSON substring
    const jsonMatch = text.match(/\{[\s\S]*\}/m);
    if (!jsonMatch) throw new Error('OpenAI did not return JSON.');
    return JSON.parse(jsonMatch[0]);
  }
}

/* --------- Shopify: create product --------- */
async function createShopifyProduct(productData) {
  // productData expected shape:
  // { title, long_description, price, tags:[...], variants:[{option1:name, price, sku}] , images:[url,...] }
  const url = `https://${SHOP}/admin/api/${API_VERSION}/products.json`;

  // construct payload
  const shopifyPayload = {
    product: {
      title: productData.title,
      body_html: productData.long_description,
      vendor: "Scary Fast",
      product_type: productData.product_type || "Apparel",
      tags: (productData.tags || []).join(','),
      variants: productData.variants || [
        { option1: "One Size", price: productData.price.toFixed ? productData.price.toFixed(2) : productData.price }
      ],
      images: (productData.images || []).map(url => ({ src: url }))
    }
  };

  const resp = await axios.post(url, shopifyPayload, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json'
    }
  });

  return resp.data;
}

/* --------- Endpoint: generate product (OpenAI) --------- */
app.post('/generate-product', async (req, res) => {
  try {
    const seed = req.body.seed || {
      brand: "Scary Fast",
      theme: "license-plate / DMV aesthetic, street speed, Louisiana vibe",
      product_type: "t-shirt",
      style_notes: "minimal, reflective ink, black/metallic palette"
    };

    const generated = await generateProductViaOpenAI(seed);

    // if OpenAI supplies price_base, compute recommended price if missing
    if (generated.price_base && !generated.recommended_price) {
      const computed = computeRetailPrice(generated.price_base, {
        inflationRate: parseFloat(process.env.INFLATION_RATE || 0.05),
        taxRate: parseFloat(process.env.SALES_TAX_RATE || 0.07),
        margin: parseFloat(process.env.PROFIT_MARGIN || 0.35)
      });
      generated.recommended_price = computed;
    }

    res.json({ ok: true, product: generated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* --------- Endpoint: create product directly in Shopify --------- */
app.post('/create-product', async (req, res) => {
  try {
    const productData = req.body.product;
    if (!productData) return res.status(400).json({ ok: false, error: 'Missing product data in body.product' });

    // ensure numeric price on variants
    if (productData.variants && productData.variants.length) {
      productData.variants = productData.variants.map(v => {
        if (v.price && typeof v.price === 'string') v.price = parseFloat(v.price);
        return v;
      });
    }

    const shopResp = await createShopifyProduct(productData);
    res.json({ ok: true, shopify: shopResp });
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    res.status(500).json({ ok: false, error: err.message, details: err.response?.data });
  }
});

/* --------- Endpoint: generate and create a single product --------- */
app.post('/generate-and-create', async (req, res) => {
  try {
    const seed = req.body.seed;
    const generated = await generateProductViaOpenAI(seed);

    // convert OpenAI structure into shopify-ready productData
    const retailPrice = generated.recommended_price || computeRetailPrice(generated.price_base || 8, {
      inflationRate: parseFloat(process.env.INFLATION_RATE || 0.05),
      taxRate: parseFloat(process.env.SALES_TAX_RATE || 0.07),
      margin: parseFloat(process.env.PROFIT_MARGIN || 0.35)
    });

    const productData = {
      title: generated.title,
      long_description: generated.long_description || generated.short_description,
      tags: generated.tags || [],
      price: retailPrice,
      product_type: seed.product_type || "Apparel",
      variants: (generated.variant_options && generated.variant_options.length)
        ? generated.variant_options[0].values.map(v => ({ option1: v, price: retailPrice }))
        : [{ option1: "One Size", price: retailPrice }],
      images: [] // leaving images empty; you can integrate Printify mockup URLs or upload images to Shopify
    };

    const shopResp = await createShopifyProduct(productData);
    res.json({ ok: true, generated, shopify: shopResp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* --------- Endpoint: bulk generate & create (example: 20 products) --------- */
app.post('/bulk-generate', async (req, res) => {
  try {
    // If the client supplies an array of seeds, use that; otherwise use demo seeds
    const seeds = req.body.seeds || generateDemoSeeds(); // function below
    const created = [];

    // Rate-limit caution: space out operations if you exceed OpenAI/Shopify rate limits
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      // generate product via OpenAI
      const gen = await generateProductViaOpenAI(seed);

      // compute price
      const retailPrice = gen.recommended_price || computeRetailPrice(gen.price_base || 8, {
        inflationRate: parseFloat(process.env.INFLATION_RATE || 0.05),
        taxRate: parseFloat(process.env.SALES_TAX_RATE || 0.07),
        margin: parseFloat(process.env.PROFIT_MARGIN || 0.35)
      });

      const productData = {
        title: gen.title,
        long_description: gen.long_description || gen.short_description,
        tags: gen.tags || [],
        price: retailPrice,
        product_type: seed.product_type || "Apparel",
        variants: (gen.variant_options && gen.variant_options.length)
          ? gen.variant_options[0].values.map(v => ({ option1: v, price: retailPrice }))
          : [{ option1: "One Size", price: retailPrice }],
        images: []
      };

      const shopResp = await createShopifyProduct(productData);

      created.push({ seed, generated: gen, shopify: shopResp });
      // NOTE: for production, add delay or queue system to avoid rate-limiting
    }

    res.json({ ok: true, created_count: created.length, created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* --------- Demo seeds generator for the 20 Scary Fast products --------- */
function generateDemoSeeds() {
  // Minimal seed objects - the OpenAI prompt uses them to generate structured product info
  const base = {
    brand: "Scary Fast",
    theme: "license-plate / DMV / Louisiana / street speed aesthetic",
    style_notes: "minimal, reflective ink, black/metallic palette, car/ID motifs",
  };

  const seeds = [
    {...base, product_type:"Hat", style_notes: base.style_notes + ", snapback license plate embroidery", variant: "One Size"},
    {...base, product_type:"Hat", style_notes: base.style_notes + ", dad cap 'SPEED LIMIT NONE'"},
    {...base, product_type:"Beanie", style_notes: base.style_notes + ", knit patch"},
    {...base, product_type:"T-Shirt", style_notes: base.style_notes + ", reflective logo chest"},
    {...base, product_type:"T-Shirt", style_notes: base.style_notes + ", highway photo-real car graphic"},
    {...base, product_type:"T-Shirt", style_notes: base.style_notes + ", Louisiana ID mockup"},
    {...base, product_type:"T-Shirt", style_notes: base.style_notes + ", 0-60 tachometer"},
    {...base, product_type:"Hoodie", style_notes: base.style_notes + ", Performance Club back print"},
    {...base, product_type:"Crewneck", style_notes: base.style_notes + ", embroidered FAST chest"},
    {...base, product_type:"Pullover", style_notes: base.style_notes + ", TURBO MODE glow print"},
    {...base, product_type:"Joggers", style_notes: base.style_notes + ", reflective side logo"},
    {...base, product_type:"Shorts", style_notes: base.style_notes + ", license plate side print"},
    {...base, product_type:"Track Pants", style_notes: base.style_notes + ", side strip branding"},
    {...base, product_type:"Windbreaker", style_notes: base.style_notes + ", reflective back text"},
    {...base, product_type:"Jacket", style_notes: base.style_notes + ", varsity license-plate patches"},
    {...base, product_type:"Keychain", style_notes: base.style_notes + ", metal license-plate tag"},
    {...base, product_type:"Stickers", style_notes: base.style_notes + ", vinyl pack"},
    {...base, product_type:"Lanyard", style_notes: base.style_notes + ", repeating ID design"},
    {...base, product_type:"Jersey", style_notes: base.style_notes + ", mesh racing jersey 00 number"},
    {...base, product_type:"Limited Hoodie", style_notes: base.style_notes + ", full-size Louisiana plate back print"}
  ];

  return seeds;
}
// --- BULK GENERATE & CREATE (safe) ---
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.post('/bulk-generate', async (req, res) => {
  try {
    const count = parseInt(req.body.count || 20, 10); // how many products to create
    const seeds = req.body.seeds || generateDemoSeeds(); // uses your existing demo seeds function
    const results = [];

    // limit to requested count
    const runSeeds = seeds.slice(0, count);

    for (let i = 0; i < runSeeds.length; i++) {
      const seed = runSeeds[i];

      // 1) Generate structured product via OpenAI
      let gen;
      try {
        gen = await generateProductViaOpenAI(seed);
      } catch (err) {
        results.push({ seedIndex: i, ok: false, error: `OpenAI error: ${err.message}` });
        // small pause and continue
        await sleep(500);
        continue;
      }

      // 2) Compute safe retail price
      const retailPrice = gen.recommended_price || computeRetailPrice(gen.price_base || 8, {
        inflationRate: parseFloat(process.env.INFLATION_RATE || 0.05),
        taxRate: parseFloat(process.env.SALES_TAX_RATE || 0.07),
        margin: parseFloat(process.env.PROFIT_MARGIN || 0.35)
      });

      // 3) Build minimal, safe Shopify product payload
      const safeProduct = {
        product: {
          title: gen.title || `${seed.product_type} - Scary Fast`,
          body_html: gen.long_description || gen.short_description || "Scary Fast product",
          vendor: "Scary Fast",
          product_type: seed.product_type || "Apparel",
          status: "draft",
          tags: (gen.tags || []).slice(0,20),
          variants: [
            { option1: "Default Title", price: (retailPrice || 39.99).toString() }
          ]
        }
      };

      // 4) Create product in Shopify
      try {
        const shopResp = await axios.post(
          `https://${SHOP}/admin/api/${API_VERSION}/products.json`,
          safeProduct,
          {
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_TOKEN,
              'Content-Type': 'application/json'
            }
          }
        );

        const created = shopResp.data && shopResp.data.product;
        results.push({ seedIndex: i, ok: true, shopifyId: created && created.id, title: created && created.title });
      } catch (shopErr) {
        // grab meaningful error message if present
        const shopMsg = shopErr.response?.data || shopErr.message || 'Shopify error';
        results.push({ seedIndex: i, ok: false, error: shopMsg });
      }

      // 5) Sleep between iterations to reduce rate-limit risk (adjust ms if desired)
      await sleep(800); // 800ms pause between creations
    }

    res.json({ ok: true, created_count: results.filter(r => r.ok).length, results });
  } catch (err) {
    console.error('bulk-generate error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
const safeProduct = {
  product: {
    title: gen.title,
    body_html: gen.long_description,
    vendor: "Scary Fast",
    product_type: seed.product_type,
    status: "draft",
    variants: [
      { option1: "Default Title", price: retailPrice.toString() }
    ],
    images: [
      { src: "https://link-to-your-printify-mockup-image.com/mockup1.png" }
    ]
  }
};
/* -------- Shopify + Printify image backfill -------- */
app.post('/update-images', async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!productIds || !Array.isArray(productIds)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid productIds array." });
    }

    const results = [];

    for (const id of productIds) {
      console.log(`Updating product ${id}...`);

      // 1️⃣ Get product details from Shopify
      const shopProd = await axios.get(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products/${id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json"
          }
        }
      );

      const product = shopProd.data.product;
      const title = product.title;
      const desc = product.body_html;

      // 2️⃣ Create a mockup on Printify (use the helper you added earlier)
      const mockupUrl = await createPrintifyMockup(
        title,
        desc,
        "https://yourdesignlibrary.com/default-design.png" // Replace this with your design library image
      );

      if (mockupUrl) {
        // 3️⃣ Add the image to Shopify
        await axios.post(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products/${id}/images.json`,
          { image: { src: mockupUrl } },
          {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json"
            }
          }
        );

        results.push({ id, ok: true, image: mockupUrl });
        console.log(`✅ Updated ${id} with image ${mockupUrl}`);
      } else {
        results.push({ id, ok: false });
      }
    }

    res.json({ ok: true, updated: results });
  } catch (err) {
    console.error("❌ Error in /update-images:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* --------- Start server --------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}.`);
  console.log(`Shop: ${SHOP}`);
});
