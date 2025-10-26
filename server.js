import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ✅ Sanity check route
app.get("/", (req, res) => {
  res.send("✅ ScaryFast Shopify app is live!");
});

// ✅ Health check route
app.get("/health", (req, res) => res.json({ status: "OK" }));

// ✅ Image update route
app.post("/update-images", async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "No product IDs provided." });
    }

    if (!SHOPIFY_DOMAIN || !ACCESS_TOKEN) {
      return res.status(500).json({
        error:
          "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN environment variable.",
      });
    }

    const updated = [];

    for (const id of productIds) {
      console.log(`🛠 Updating product ID: ${id}`);

      const shopifyRes = await axios.get(
        `https://${SHOPIFY_DOMAIN}/admin/api/2024-07/products/${id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      const product = shopifyRes.data.product;
      if (!product) continue;

      const title = product.title || "Untitled Product";
      const newImage = `https://via.placeholder.com/800x800.png?text=${encodeURIComponent(
        title
      )}`;

      await axios.put(
        `https://${SHOPIFY_DOMAIN}/admin/api/2024-07/products/${id}.json`,
        {
          product: { id, images: [{ src: newImage }] },
        },
        {
          headers: {
            "X-Shopify-Access-Token": ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      updated.push({ id, title, newImage });
      console.log(`✅ Updated ${title}`);
    }

    res.json({ success: true, updated });
  } catch (error) {
    console.error("❌ Error in /update-images:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
