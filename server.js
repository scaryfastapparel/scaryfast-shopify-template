import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 🧩 Root route
app.get("/", (req, res) => {
  res.send("✅ ScaryFast Shopify Template is running.");
});

// 🧩 Test route
app.get("/ping", (req, res) => {
  res.json({ message: "pong" });
});

// 🧩 Update images route (Printify integration ready)
app.post("/update-images", async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "No product IDs provided." });
    }

    const updated = [];

    for (const id of productIds) {
      console.log(`🛠️ Updating product ID: ${id}`);

      // Fetch product from Shopify
      const shopifyRes = await axios.get(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products/${id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      const product = shopifyRes.data.product;
      if (!product) {
        console.warn(`⚠️ No product found for ID: ${id}`);
        continue;
      }

      const title = product.title || "Untitled Product";
      const desc = product.body_html || "No description provided.";

      // Mock Printify image generation (placeholder)
      const mockImageUrl = `https://via.placeholder.com/800x800.png?text=${encodeURIComponent(
        title
      )}`;

      // Update product image in Shopify
      const updateRes = await axios.put(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products/${id}.json`,
        {
          product: {
            id: id,
            images: [{ src: mockImageUrl }],
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      updated.push({
        id,
        title,
        image: mockImageUrl,
        status: "updated",
      });

      console.log(`✅ Updated: ${title}`);
    }

    res.json({ success: true, updated });
  } catch (error) {
    console.error("❌ Error in /update-images:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🧩 Keep-alive route
app.get("/health", (req, res) => {
  res.send("OK");
});
// 🖼️ Generate Printify mockups for existing Shopify products
app.post("/generate-printify-images", async (req, res) => {
  try {
    const shopifyRes = await axios.get(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    const products = shopifyRes.data.products;

    const updatedProducts = [];

    for (const product of products) {
      const mockupPrompt = `${product.title} - ${product.body_html
        .replace(/<[^>]+>/g, "")
        .slice(0, 150)} (T-shirt mockup, plain background, front view, photorealistic lighting)`;

      // Call Printify's product creation endpoint
      const printifyProduct = await axios.post(
        `https://api.printify.com/v1/shops/${process.env.PRINTIFY_SHOP_ID}/products.json`,
        {
          title: product.title,
          description: product.body_html,
          blueprint_id: 6, // Classic T-shirt
          print_provider_id: 1,
          variants: [
            {
              id: 1,
              price: 1500,
              is_enabled: true,
            },
          ],
          print_areas: [
            {
              variant_ids: [1],
              placeholders: [
                {
                  position: "front",
                  images: [
                    {
                      src: `https://api.openai.com/v1/images/generations`, // placeholder for now
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      updatedProducts.push({
        shopify_title: product.title,
        printify_id: printifyProduct.data.id,
      });
    }

    res.json({
      message: `🖼️ Successfully created Printify mockups for ${updatedProducts.length} products`,
      updatedProducts,
    });
  } catch (error) {
    console.error("❌ Printify image generation error:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🧩 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
