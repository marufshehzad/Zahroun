/* Seed catalogue images.
   These are published synchronously by js/store.js on EVERY page load, before
   Firestore data arrives, so the storefront never shows an empty grid. They
   previously pointed at Cloudinary cloud "dj3nmxfj0", which has been disabled
   since the ImageKit migration (commit 1b6bd18) and returns HTTP 401 — so every
   cold visit first-painted broken images, and a Firestore outage left them
   broken permanently.

   They now point at the repo's own `product pictures/` tree, which is
   git-tracked and already served from the live origin (index.html and
   about.html load from it directly), so no upload step is required.

   The URLs are ABSOLUTE, not relative, on purpose: order-confirmation emails
   (checkout.html) and the product page's og:image / JSON-LD both embed these
   values, and neither can resolve a relative path. Absolute https URLs also
   keep js/store.js:32's `startsWith("http")` branch on its existing path. */
const CDN = "https://zahroun.com/product%20pictures/New%20product%20pic%20and%20price";

const commonImages = {
    men6:     CDN + "/men%206ml.png",
    men15:    CDN + "/men%2015ml%20size.png",
    women6:   CDN + "/women%206ml%20.png",
    women15:  CDN + "/women%2015ml%20size.png",
    premium50: CDN + "/IMG_4061.png"
};

const products = [
    {
        id: 1,
        name: "Sahraa Oudh",
        category: "Men",
        price: 2490,
        prices: { "6ML": 790, "15ML": 1290, "30ML": 1890, "50ML": 2490 },
        sizeImages: {
            "6ML":  commonImages.men6,
            "15ML": commonImages.men15,
            "30ML": CDN + "/Sahraa%20Oudh%2030ml.png",
            "50ML": CDN + "/Sahraa%20Oudh%2050ml.webp"
        },
        image: CDN + "/Sahraa%20Oudh%2050ml.webp",
        description: "A deep oud fragrance with floral, resinous, and musky warmth.",
        ingredients: "Oud, Patchouli, Rose, Jasmine, Saffron, Mandarin, Amberwood, Ambergris, Fir Resin, Cedar, Musk.",
        tags: { gender: "For him", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Oud", "Patchouli", "Rose", "Jasmine", "Saffron", "Mandarin", "Amberwood", "Ambergris", "Fir Resin", "Cedar", "Musk"],
        seasons: ["Fall", "Winter"],
        occasions: ["Evening", "Formal", "Signature"]
    },
    {
        id: 2,
        name: "Dulce Oud",
        category: "Unisex",
        price: 2450,
        prices: { "6ML": 750, "15ML": 1250, "30ML": 1850, "50ML": 2450 },
        sizeImages: {
            "6ML":  commonImages.men6,
            "15ML": commonImages.men15,
            "30ML": CDN + "/Dulce%20Oud%2030ml.png",
            "50ML": CDN + "/Dulce%20Oud%2050ml.webp"
        },
        image: CDN + "/Dulce%20Oud%2050ml.webp",
        description: "A sweet amber-oud profile balanced with saffron, jasmine, cedar, and moss.",
        ingredients: "Saffron, Jasmine, Amberwood, Ambergris, Oud, Hedione, Fir Resin, Cedar, Sugar, Ambroxan, Oakmoss.",
        tags: { gender: "Unisex", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Saffron", "Jasmine", "Amberwood", "Ambergris", "Oud", "Hedione", "Fir Resin", "Cedar", "Sugar", "Ambroxan", "Oakmoss"],
        seasons: ["Fall", "Winter", "Spring"],
        occasions: ["Evening", "Signature", "Date Night"]
    },
    {
        id: 3,
        name: "Rosy Diva",
        category: "Women",
        price: 1790,
        prices: { "6ML": 550, "15ML": 850, "30ML": 1200, "50ML": 1790 },
        sizeImages: {
            "6ML":  commonImages.women6,
            "15ML": commonImages.women15,
            "30ML": CDN + "/women%20Rosy%20Diva%2030ml.png",
            "50ML": CDN + "/women%20Rosy%20Diva%2050ml.webp"
        },
        image: CDN + "/women%20Rosy%20Diva%2050ml.webp",
        description: "A bright feminine rose scent with lychee, pear, pink pepper, flowers, musk, and soft woods.",
        ingredients: "Lychee, Pear, Bergamot Essence, Pink Pepper, Turkish Rose, Peony, Flowers, White Musk, Soft Wood, Haitian Vetiver.",
        tags: { gender: "For her", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Lychee", "Pear", "Bergamot Essence", "Pink Pepper", "Turkish Rose", "Peony", "Flowers", "White Musk", "Soft Wood", "Haitian Vetiver"],
        seasons: ["Spring", "Summer"],
        occasions: ["Daytime", "Date Night", "Signature"]
    },
    {
        id: 4,
        name: "Alpha Core",
        category: "Men",
        price: 1490,
        prices: { "6ML": 450, "15ML": 750, "30ML": 990, "50ML": 1490 },
        sizeImages: {
            "6ML":  commonImages.men6,
            "15ML": commonImages.men15,
            "30ML": CDN + "/IMG_5952.png",
            "50ML": commonImages.premium50
        },
        image: commonImages.premium50,
        description: "Summer Edition. A fresh tropical-woody fragrance with pineapple, ginger, coconut, sandalwood, and ambergris.",
        ingredients: "Pineapple, Iris, Ginger, Cypress, Coconut, Woodsy Notes, Tonka Bean, Sandalwood, Amber, Ambergris.",
        tags: { gender: "For him", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Pineapple", "Iris", "Ginger", "Cypress", "Coconut", "Woodsy Notes", "Tonka Bean", "Sandalwood", "Amber", "Ambergris"],
        seasons: ["Summer", "Spring"],
        occasions: ["Daytime", "Casual", "Office"]
    },
    {
        id: 5,
        name: "AL Khayran",
        category: "Men",
        price: 2590,
        prices: { "6ML": 790, "15ML": 1390, "30ML": 1990, "50ML": 2590 },
        sizeImages: {
            "6ML":  commonImages.men6,
            "15ML": commonImages.men15,
            "30ML": CDN + "/AL%20Khayran%2030ml.png",
            "50ML": CDN + "/AL%20Khayran%2050ml.webp"
        },
        image: CDN + "/AL%20Khayran%2050ml.webp",
        description: "A rich masculine blend with warm amber, leather, honey, white florals, and musky depth.",
        ingredients: "Woody, Amber, Sweet, Warm Spicy, White Floral, Animalic, Musky, Wood, Leather, Honey.",
        tags: { gender: "For him", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Woody", "Amber", "Sweet", "Warm Spicy", "White Floral", "Animalic", "Musky", "Wood", "Leather", "Honey"],
        seasons: ["Fall", "Winter"],
        occasions: ["Evening", "Formal", "Signature"]
    },
    {
        id: 6,
        name: "Chivas",
        category: "Men",
        price: 1690,
        prices: { "6ML": 500, "15ML": 800, "30ML": 1090, "50ML": 1690 },
        sizeImages: {
            "6ML":  commonImages.men6,
            "15ML": commonImages.men15,
            "30ML": CDN + "/Chivas%2030ml.jpg",
            "50ML": CDN + "/Chivas%2050ml.png"
        },
        image: CDN + "/Chivas%2050ml.png",
        description: "A smooth aromatic fragrance with rum accord, lavender, vanilla, chestnut, cedarwood, and patchouli.",
        ingredients: "Rum Accord, Bergamot, Mandarin Orange, Lavender, Davana, Violet, Vanilla, Chestnut, Cedarwood, Patchouli.",
        tags: { gender: "For him", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Rum Accord", "Bergamot", "Mandarin Orange", "Lavender", "Davana", "Violet", "Vanilla", "Chestnut", "Cedarwood", "Patchouli"],
        seasons: ["Fall", "Winter", "Spring"],
        occasions: ["Evening", "Date Night", "Casual"]
    },
    {
        id: 7,
        name: "Solvane",
        category: "Men",
        price: 1400,
        prices: { "6ML": 390, "15ML": 600, "30ML": 890, "50ML": 1400 },
        sizeImages: {
            "6ML":  commonImages.men6,
            "15ML": commonImages.men15,
            "30ML": CDN + "/IMG_5965.png",
            "50ML": commonImages.premium50
        },
        image: commonImages.premium50,
        description: "A fresh spicy fragrance with bergamot, pepper, lavender, vetiver, patchouli, ambroxan, and cedar.",
        ingredients: "Calabrian Bergamot, Pepper, Sichuan Pepper, Lavender, Pink Pepper, Vetiver, Patchouli, Geranium, Elemi, Ambroxan, Cedar.",
        tags: { gender: "For him", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Calabrian Bergamot", "Pepper", "Sichuan Pepper", "Lavender", "Pink Pepper", "Vetiver", "Patchouli", "Geranium", "Elemi", "Ambroxan", "Cedar"],
        seasons: ["Summer", "Spring"],
        occasions: ["Daytime", "Office", "Casual"]
    },
    {
        id: 8,
        name: "Pink Sapphire",
        category: "Women",
        price: 1700,
        prices: { "6ML": 500, "15ML": 800, "30ML": 1000, "50ML": 1700 },
        sizeImages: {
            "6ML":  commonImages.women6,
            "15ML": commonImages.women15,
            "30ML": CDN + "/women%20pink%20sapphire%2030ml.png",
            "50ML": CDN + "/women%20pink%20sapphire%2050ml.png"
        },
        image: CDN + "/women%20pink%20sapphire%2050ml.png",
        description: "A sparkling feminine scent with pear blossom, red berries, gardenia, jasmine, brown sugar, and patchouli.",
        ingredients: "Pear Blossom, Red Berries, Italian Mandarin, White Gardenia, Jasmine, Frangipani, Brown Sugar, Patchouli.",
        tags: { gender: "For her", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Pear Blossom", "Red Berries", "Italian Mandarin", "White Gardenia", "Jasmine", "Frangipani", "Brown Sugar", "Patchouli"],
        seasons: ["Spring", "Summer"],
        occasions: ["Daytime", "Date Night", "Casual"]
    },
    {
        id: 9,
        name: "Elifra",
        category: "Women",
        price: 1700,
        prices: { "6ML": 500, "15ML": 800, "30ML": 1000, "50ML": 1700 },
        sizeImages: {
            "6ML":  commonImages.women6,
            "15ML": commonImages.women15,
            "30ML": CDN + "/women%20Elifra%2030ml.png",
            "50ML": CDN + "/women%20Elifra%2050ml.png"
        },
        image: CDN + "/women%20Elifra%2050ml.png",
        description: "A gourmand floral composition with almond, coffee, jasmine, rose, vanilla, cacao, woods, and musk.",
        ingredients: "Almond, Coffee, Bergamot, Lemon, Jasmine Sambac, Tuberose, Orris, Bulgarian Rose, Orange Blossom, Cacao, Vanilla, Sandalwood, Amber, Musk, Cashmere Wood, Cinnamon, Patchouli, Cedar.",
        tags: { gender: "For her", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Almond", "Coffee", "Bergamot", "Lemon", "Jasmine Sambac", "Tuberose", "Orris", "Bulgarian Rose", "Orange Blossom", "Cacao", "Vanilla", "Sandalwood", "Amber", "Musk", "Cashmere Wood", "Cinnamon", "Patchouli", "Cedar"],
        seasons: ["Fall", "Winter"],
        occasions: ["Evening", "Date Night", "Signature"]
    },
    {
        id: 10,
        name: "Piyora",
        category: "Women",
        price: 1550,
        prices: { "6ML": 450, "15ML": 750, "30ML": 950, "50ML": 1550 },
        sizeImages: {
            "6ML":  commonImages.women6,
            "15ML": commonImages.women15,
            "30ML": CDN + "/women%20piyora%2030ml.png",
            "50ML": commonImages.premium50
        },
        image: commonImages.premium50,
        description: "A soft floral vanilla fragrance with bergamot, neroli, pear, jasmine, moss, and white musk.",
        ingredients: "Bergamot Essence, Neroli Bud, Pear, Jasmine Superinfusion, Neroli Essence, Moss, Bourbon Vanilla, Natural Vanillin, White Musk.",
        tags: { gender: "For her", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Bergamot Essence", "Neroli Bud", "Pear", "Jasmine Superinfusion", "Neroli Essence", "Moss", "Bourbon Vanilla", "Natural Vanillin", "White Musk"],
        seasons: ["Spring", "Summer"],
        occasions: ["Daytime", "Office", "Casual"]
    },
    {
        id: 11,
        name: "Bellavie",
        category: "Women",
        price: 1690,
        prices: { "6ML": 500, "15ML": 800, "30ML": 1090, "50ML": 1690 },
        sizeImages: {
            "6ML":  commonImages.women6,
            "15ML": commonImages.women15,
            "30ML": CDN + "/women%20Bellavie%2030ml.png",
            "50ML": CDN + "/Women%20Bellavie%2050ml.png"
        },
        image: CDN + "/Women%20Bellavie%2050ml.png",
        description: "A fruity floral scent with passion fruit, grapefruit, pineapple, strawberry, vanilla orchid, jasmine, musk, and woods.",
        ingredients: "Purple Passion Fruit, Grapefruit, Pineapple, Tangerine, Big Strawberry, Vanilla Orchid, Red Berries, Jasmine, Lily, Musk, Woody.",
        tags: { gender: "For her", type: "Spray", concentration: "Eau de parfum" },
        fragrance_notes: ["Purple Passion Fruit", "Grapefruit", "Pineapple", "Tangerine", "Big Strawberry", "Vanilla Orchid", "Red Berries", "Jasmine", "Lily", "Musk", "Woody"],
        seasons: ["Spring", "Summer"],
        occasions: ["Daytime", "Casual", "Date Night"]
    }
];

/* Exported for js/store.js: used to seed Firestore and as an offline
   fallback so the storefront never renders empty. */
export { products as seedProducts };
