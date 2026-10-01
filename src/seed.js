// Starting catalog: the family's meals and estimated King Soopers prices.
// Loaded into the database the first time the app runs. Prices are estimates until the Kroger API is connected.
export const SEED_CATALOG = {
  "version": 1,
  "settings": {
    "weeklyBudget": 400,
    "adultPortions": 3.5,
    "milkPerWeek": 1.5,
    "store": "King Soopers"
  },
  "aisles": [
    "Produce",
    "Meat",
    "Dairy & eggs",
    "Bakery",
    "Pantry",
    "Frozen"
  ],
  "products": {
    "beef": {
      "name": "Ground beef 80/20",
      "size": "1 lb",
      "price": 5.99,
      "aisle": "Meat",
      "shareName": "ground beef"
    },
    "buns": {
      "name": "Kroger hamburger buns",
      "size": "8 ct",
      "price": 2.49,
      "aisle": "Bakery"
    },
    "cheddarSl": {
      "name": "Kroger sharp cheddar slices",
      "size": "16 ct",
      "price": 3.49,
      "aisle": "Dairy & eggs",
      "shareName": "cheddar"
    },
    "fries": {
      "name": "Ore-Ida Golden Crinkles fries",
      "size": "32 oz",
      "price": 5.49,
      "aisle": "Frozen"
    },
    "romaine": {
      "name": "Romaine hearts",
      "size": "3 ct",
      "price": 3.99,
      "aisle": "Produce",
      "shareName": "romaine"
    },
    "roma": {
      "name": "Roma tomatoes",
      "size": "about 1 lb",
      "price": 1.79,
      "aisle": "Produce",
      "shareName": "tomatoes"
    },
    "onion": {
      "name": "Yellow onions",
      "size": "each",
      "price": 0.99,
      "aisle": "Produce"
    },
    "condiments": {
      "name": "Ketchup & mustard",
      "size": "",
      "price": 3.49,
      "aisle": "Pantry",
      "pantry": true
    },
    "mexCheese": {
      "name": "Kroger shredded Mexican blend",
      "size": "8 oz",
      "price": 2.49,
      "aisle": "Dairy & eggs",
      "shareName": "shredded cheese"
    },
    "sourCream": {
      "name": "Kroger sour cream",
      "size": "16 oz",
      "price": 2.29,
      "aisle": "Dairy & eggs",
      "shareName": "sour cream"
    },
    "salsa": {
      "name": "Simple Truth Organic mild salsa",
      "size": "16 oz",
      "price": 3.49,
      "aisle": "Pantry",
      "dyeRisk": true,
      "shareName": "salsa"
    },
    "chips": {
      "name": "Simple Truth Organic tortilla chips, plain",
      "size": "12 oz",
      "price": 3.29,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "blackBeans": {
      "name": "Kroger black beans",
      "size": "15 oz can",
      "price": 0.99,
      "aisle": "Pantry"
    },
    "tacoSeas": {
      "name": "Simple Truth Organic taco seasoning",
      "size": "1 oz",
      "price": 1.49,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "penne": {
      "name": "Barilla penne",
      "size": "16 oz",
      "price": 1.99,
      "aisle": "Pantry"
    },
    "marinara": {
      "name": "Kroger marinara sauce",
      "size": "24 oz",
      "price": 2.49,
      "aisle": "Pantry"
    },
    "itSausage": {
      "name": "Johnsonville mild Italian sausage",
      "size": "19 oz, 5 links",
      "price": 6.49,
      "aisle": "Meat",
      "dyeRisk": true,
      "shareName": "Italian sausage"
    },
    "bkSausage": {
      "name": "Johnsonville original breakfast links",
      "size": "12 oz",
      "price": 4.99,
      "aisle": "Meat",
      "dyeRisk": true
    },
    "parm": {
      "name": "Kroger grated parmesan",
      "size": "8 oz",
      "price": 3.99,
      "aisle": "Dairy & eggs"
    },
    "eggs": {
      "name": "Kroger large eggs",
      "size": "dozen",
      "price": 3.29,
      "aisle": "Dairy & eggs",
      "shareName": "eggs"
    },
    "milk": {
      "name": "Lactaid whole milk",
      "size": "half gallon",
      "price": 4.79,
      "aisle": "Dairy & eggs"
    },
    "flour": {
      "name": "All-purpose flour",
      "size": "5 lb",
      "price": 3.49,
      "aisle": "Pantry",
      "pantry": true
    },
    "butter": {
      "name": "Butter",
      "size": "1 lb",
      "price": 4.49,
      "aisle": "Pantry",
      "pantry": true
    },
    "jam": {
      "name": "Simple Truth Organic strawberry spread",
      "size": "10 oz",
      "price": 3.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "sweetPot": {
      "name": "Sweet potatoes",
      "size": "3 lb bag",
      "price": 3.99,
      "aisle": "Produce"
    },
    "kale": {
      "name": "Kale",
      "size": "bunch",
      "price": 2.49,
      "aisle": "Produce",
      "shareName": "kale"
    },
    "sourdough": {
      "name": "Kroger sourdough bread",
      "size": "loaf",
      "price": 3.29,
      "aisle": "Bakery"
    },
    "tomSoup": {
      "name": "Campbell's condensed tomato soup",
      "size": "10.75 oz can",
      "price": 1.49,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "thighs": {
      "name": "Boneless chicken thighs",
      "size": "about 1.5 lb",
      "price": 6.49,
      "aisle": "Meat"
    },
    "carrots": {
      "name": "Carrots",
      "size": "2 lb bag",
      "price": 1.99,
      "aisle": "Produce",
      "shareName": "carrots"
    },
    "celery": {
      "name": "Celery",
      "size": "bunch",
      "price": 1.99,
      "aisle": "Produce"
    },
    "noodles": {
      "name": "Kroger wide egg noodles",
      "size": "12 oz",
      "price": 2.29,
      "aisle": "Pantry"
    },
    "broth": {
      "name": "Kroger chicken broth",
      "size": "32 oz",
      "price": 2.49,
      "aisle": "Pantry"
    },
    "breasts": {
      "name": "Boneless chicken breasts",
      "size": "about 3 lb",
      "price": 10.49,
      "aisle": "Meat",
      "shareName": "chicken"
    },
    "zucchini": {
      "name": "Zucchini",
      "size": "each",
      "price": 1.29,
      "aisle": "Produce"
    },
    "peppers": {
      "name": "Bell peppers",
      "size": "3 pack",
      "price": 3.99,
      "aisle": "Produce"
    },
    "rice": {
      "name": "Kroger jasmine rice",
      "size": "2 lb",
      "price": 2.99,
      "aisle": "Pantry",
      "shareName": "rice"
    },
    "oil": {
      "name": "Olive oil",
      "size": "",
      "price": 7.99,
      "aisle": "Pantry",
      "pantry": true
    },
    "sirloin": {
      "name": "Top sirloin steak, family pack",
      "size": "about 2.5 lb",
      "price": 24.99,
      "aisle": "Meat"
    },
    "russets": {
      "name": "Russet potatoes",
      "size": "5 lb bag",
      "price": 4.49,
      "aisle": "Produce"
    },
    "broccoli": {
      "name": "Broccoli crowns",
      "size": "about 1.5 lb",
      "price": 3.49,
      "aisle": "Produce"
    },
    "pizzaCrust": {
      "name": "Kroger refrigerated pizza crust",
      "size": "13.8 oz",
      "price": 2.99,
      "aisle": "Dairy & eggs"
    },
    "mozz": {
      "name": "Kroger shredded mozzarella",
      "size": "16 oz",
      "price": 4.49,
      "aisle": "Dairy & eggs"
    },
    "pizzaSauce": {
      "name": "Kroger pizza sauce",
      "size": "14 oz",
      "price": 1.99,
      "aisle": "Pantry"
    },
    "pepperoni": {
      "name": "Hormel pepperoni",
      "size": "6 oz",
      "price": 3.49,
      "aisle": "Meat",
      "dyeRisk": true
    },
    "peasCarrots": {
      "name": "Kroger frozen peas & carrots",
      "size": "12 oz",
      "price": 1.49,
      "aisle": "Frozen"
    },
    "greenOnion": {
      "name": "Green onions",
      "size": "bunch",
      "price": 0.99,
      "aisle": "Produce"
    },
    "soy": {
      "name": "Soy sauce",
      "size": "",
      "price": 2.99,
      "aisle": "Pantry",
      "pantry": true
    },
    "tortillas": {
      "name": "Kroger flour tortillas",
      "size": "10 ct",
      "price": 2.99,
      "aisle": "Bakery"
    },
    "refried": {
      "name": "Kroger refried beans",
      "size": "16 oz can",
      "price": 1.49,
      "aisle": "Pantry"
    },
    "spices": {
      "name": "Salt, pepper & spices",
      "size": "",
      "price": 4,
      "aisle": "Pantry",
      "pantry": true
    },
    "bread": {
      "name": "Kroger 100% whole wheat bread",
      "size": "loaf",
      "price": 2.49,
      "aisle": "Bakery"
    },
    "bananas": {
      "name": "Bananas",
      "size": "about 2.5 lb",
      "price": 1.49,
      "aisle": "Produce"
    },
    "apples": {
      "name": "Gala apples",
      "size": "3 lb bag",
      "price": 4.49,
      "aisle": "Produce"
    },
    "yogurt": {
      "name": "Simple Truth Organic plain yogurt",
      "size": "32 oz",
      "price": 4.29,
      "aisle": "Dairy & eggs",
      "dyeRisk": true
    },
    "cereal": {
      "name": "Cheerios, original (dye-free)",
      "size": "18 oz",
      "price": 4.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "pb": {
      "name": "Kroger creamy peanut butter",
      "size": "16 oz",
      "price": 2.29,
      "aisle": "Pantry"
    },
    "turkey": {
      "name": "Deli turkey",
      "size": "9 oz",
      "price": 4.99,
      "aisle": "Meat"
    },
    "stringCheese": {
      "name": "Kroger string cheese",
      "size": "12 ct",
      "price": 3.99,
      "aisle": "Dairy & eggs"
    },
    "oats": {
      "name": "Kroger old fashioned oats",
      "size": "42 oz",
      "price": 4.49,
      "aisle": "Pantry"
    },
    "brownSugar": {
      "name": "Brown sugar",
      "size": "",
      "price": 2.49,
      "aisle": "Pantry",
      "pantry": true
    },
    "syrup": {
      "name": "Maple syrup",
      "size": "",
      "price": 7.99,
      "aisle": "Pantry",
      "pantry": true
    },
    "krusteaz": {
      "name": "Krusteaz buttermilk pancake mix",
      "size": "32 oz",
      "price": 4.29,
      "aisle": "Pantry",
      "dyeRisk": true,
      "dyeChecked": "2026-09-30"
    },
    "frozenPizza": {
      "name": "Red Baron classic crust pepperoni pizza",
      "size": "frozen, 20.6 oz",
      "price": 5.99,
      "aisle": "Frozen",
      "dyeRisk": true
    },
    "gfPizza": {
      "name": "Simple Truth gluten-free cauliflower crust pizza",
      "size": "frozen, 11 oz",
      "price": 6.99,
      "aisle": "Frozen",
      "dyeRisk": true
    },
    "ftSticks": {
      "name": "Kroger French toast sticks, frozen",
      "size": "24 ct",
      "price": 4.99,
      "aisle": "Frozen",
      "dyeRisk": true
    },
    "frozenWaffles": {
      "name": "Kodiak Power Waffles, frozen",
      "size": "8 ct",
      "price": 5.49,
      "aisle": "Frozen",
      "dyeRisk": true,
      "dyeChecked": "2026-09-30"
    },
    "strawberries": {
      "name": "Strawberries",
      "size": "1 lb",
      "price": 3.99,
      "aisle": "Produce"
    },
    "granola": {
      "name": "Simple Truth Organic granola",
      "size": "12 oz",
      "price": 3.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "jelly": {
      "name": "Welch's concord grape jelly",
      "size": "30 oz",
      "price": 3.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "macCheese": {
      "name": "Annie's shells & white cheddar",
      "size": "6 oz box",
      "price": 1.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "goldfish": {
      "name": "Goldfish crackers, original cheddar",
      "size": "30 oz carton",
      "price": 9.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "pouches": {
      "name": "GoGo squeeZ applesauce pouches",
      "size": "12 ct",
      "price": 7.99,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "granolaBars": {
      "name": "Kroger chewy granola bars, chocolate chip",
      "size": "8 ct",
      "price": 2.49,
      "aisle": "Pantry",
      "dyeRisk": true
    },
    "babyCarrots": {
      "name": "Baby carrots",
      "size": "1 lb",
      "price": 1.49,
      "aisle": "Produce"
    },
    "pretzels": {
      "name": "Snyder's mini pretzels",
      "size": "16 oz",
      "price": 3.99,
      "aisle": "Pantry"
    },
    "clementines": {
      "name": "Clementines",
      "size": "3 lb bag",
      "price": 5.99,
      "aisle": "Produce"
    },
    "popcorn": {
      "name": "SkinnyPop popcorn",
      "size": "6 pack",
      "price": 5.49,
      "aisle": "Pantry"
    }
  },
  "dinners": [
    {
      "id": "sweetPotato",
      "name": "Sweet potato, kale & sausage",
      "items": [
        [
          "sweetPot",
          1
        ],
        [
          "kale",
          1
        ],
        [
          "itSausage",
          1
        ],
        [
          "onion",
          1
        ],
        [
          "oil",
          0.05
        ],
        [
          "spices",
          0.05
        ]
      ],
      "takeout": 50,
      "takeoutName": "Takeout bowls"
    },
    {
      "id": "chickenSoup",
      "name": "Chicken noodle soup",
      "items": [
        [
          "thighs",
          1
        ],
        [
          "carrots",
          0.4
        ],
        [
          "celery",
          0.5
        ],
        [
          "onion",
          1
        ],
        [
          "noodles",
          1
        ],
        [
          "broth",
          2
        ],
        [
          "spices",
          0.05
        ]
      ],
      "takeout": 45,
      "takeoutName": "Panera for 5",
      "good": "Makes about 2 lunches of leftovers."
    },
    {
      "id": "tacoSalad",
      "name": "Taco salad",
      "items": [
        [
          "beef",
          1.5
        ],
        [
          "romaine",
          0.67
        ],
        [
          "roma",
          0.5
        ],
        [
          "mexCheese",
          1
        ],
        [
          "sourCream",
          0.5
        ],
        [
          "salsa",
          0.5
        ],
        [
          "chips",
          1
        ],
        [
          "blackBeans",
          1
        ],
        [
          "tacoSeas",
          1
        ]
      ],
      "takeout": 58,
      "takeoutName": "Chipotle for 5",
      "dyeTip": "Nacho-flavored chips often contain Red 40. The plain Simple Truth chips on your list are checked."
    },
    {
      "id": "pastaSausage",
      "name": "Pasta & sausage",
      "items": [
        [
          "penne",
          1
        ],
        [
          "marinara",
          1
        ],
        [
          "itSausage",
          1
        ],
        [
          "parm",
          0.2
        ],
        [
          "onion",
          0.5
        ],
        [
          "spices",
          0.05
        ]
      ],
      "takeout": 62,
      "takeoutName": "Olive Garden to-go"
    },
    {
      "id": "grilledChicken",
      "name": "Grilled chicken & veggies",
      "items": [
        [
          "breasts",
          1
        ],
        [
          "zucchini",
          2
        ],
        [
          "peppers",
          1
        ],
        [
          "rice",
          0.35
        ],
        [
          "oil",
          0.05
        ],
        [
          "spices",
          0.05
        ]
      ],
      "takeout": 60,
      "takeoutName": "Takeout plates",
      "good": "Grill the whole pack. Leftover chicken turns into fried rice later in the week."
    },
    {
      "id": "pizza",
      "name": "Homemade pizza night",
      "items": [
        [
          "pizzaCrust",
          2
        ],
        [
          "mozz",
          1
        ],
        [
          "pizzaSauce",
          1
        ],
        [
          "pepperoni",
          1
        ]
      ],
      "idea": true,
      "takeout": 48,
      "takeoutName": "Delivery pizza",
      "good": "The kids can top their own. It stands in for a delivery night."
    },
    {
      "id": "pancakes",
      "name": "Swedish pancakes & sausage",
      "items": [
        [
          "flour",
          0.08
        ],
        [
          "eggs",
          0.5
        ],
        [
          "milk",
          0.3
        ],
        [
          "butter",
          0.1
        ],
        [
          "bkSausage",
          1
        ],
        [
          "jam",
          0.3
        ],
        [
          "bananas",
          0.4
        ]
      ],
      "takeout": 52,
      "takeoutName": "Diner breakfast",
      "dyeTip": "Many strawberry syrups and toppings use Red 40. The Simple Truth spread on your list is checked."
    },
    {
      "id": "grilledCheese",
      "name": "Grilled cheese & tomato soup",
      "items": [
        [
          "sourdough",
          0.7
        ],
        [
          "cheddarSl",
          0.6
        ],
        [
          "butter",
          0.15
        ],
        [
          "tomSoup",
          3
        ]
      ],
      "takeout": 42,
      "takeoutName": "Panera for 5"
    },
    {
      "id": "burgers",
      "name": "Cheeseburgers & fries",
      "items": [
        [
          "beef",
          2
        ],
        [
          "buns",
          0.75
        ],
        [
          "cheddarSl",
          0.4
        ],
        [
          "fries",
          0.75
        ],
        [
          "romaine",
          0.33
        ],
        [
          "roma",
          0.5
        ],
        [
          "onion",
          0.5
        ],
        [
          "condiments",
          0.15
        ],
        [
          "spices",
          0.05
        ]
      ],
      "takeout": 64,
      "takeoutName": "Five Guys for 5"
    },
    {
      "id": "steak",
      "name": "Steak night",
      "items": [
        [
          "sirloin",
          1
        ],
        [
          "russets",
          0.4
        ],
        [
          "broccoli",
          1
        ],
        [
          "butter",
          0.1
        ],
        [
          "spices",
          0.05
        ]
      ],
      "takeout": 140,
      "takeoutName": "Steakhouse for 5",
      "good": "Top sirloin bought on sale and frozen keeps this a treat, not a splurge."
    },
    {
      "id": "frozenPizza",
      "name": "Frozen pizza night",
      "items": [
        [
          "frozenPizza",
          2
        ],
        [
          "babyCarrots",
          0.5
        ]
      ],
      "takeout": 45,
      "takeoutName": "Delivery pizza",
      "good": "Two frozen pizzas and carrot sticks feed everyone for about a quarter of what delivery costs."
    },
    {
      "id": "dateNight",
      "name": "Date night (sitter & kids)",
      "items": [
        [
          "frozenPizza",
          1
        ],
        [
          "gfPizza",
          1
        ],
        [
          "babyCarrots",
          0.3
        ]
      ],
      "takeout": 45,
      "takeoutName": "Delivery for sitter & kids",
      "good": "A gluten-free pizza for the sitter and a regular one for the kids. Your dinner out comes from the eating-out money."
    },
    {
      "id": "friedRice",
      "name": "Chicken fried rice",
      "items": [
        [
          "rice",
          0.35
        ],
        [
          "eggs",
          0.25
        ],
        [
          "peasCarrots",
          1
        ],
        [
          "greenOnion",
          1
        ],
        [
          "soy",
          0.1
        ],
        [
          "breasts",
          0.3
        ],
        [
          "oil",
          0.03
        ]
      ],
      "idea": true,
      "takeout": 50,
      "takeoutName": "Chinese takeout",
      "good": "Best the night after grilled chicken. It uses the leftovers."
    },
    {
      "id": "quesadillas",
      "name": "Bean & cheese quesadillas",
      "items": [
        [
          "tortillas",
          1
        ],
        [
          "refried",
          1
        ],
        [
          "mexCheese",
          1
        ],
        [
          "salsa",
          0.5
        ],
        [
          "sourCream",
          0.3
        ]
      ],
      "idea": true,
      "takeout": 45,
      "takeoutName": "Takeout tacos",
      "good": "A good one to keep in the freezer for tired nights."
    }
  ],
  "breakfasts": [
    {
      "id": "cereal",
      "name": "Dye-free cereal & milk",
      "items": [
        [
          "cereal",
          0.3
        ],
        [
          "milk",
          0.3
        ],
        [
          "bananas",
          0.2
        ]
      ]
    },
    {
      "id": "frozen",
      "name": "Kodiak frozen waffles or pancakes",
      "items": [
        [
          "frozenWaffles",
          0.9
        ],
        [
          "syrup",
          0.1
        ],
        [
          "bananas",
          0.2
        ]
      ]
    },
    {
      "id": "frenchToast",
      "name": "Frozen French toast sticks",
      "items": [
        [
          "ftSticks",
          0.6
        ],
        [
          "syrup",
          0.1
        ],
        [
          "bananas",
          0.2
        ]
      ]
    },
    {
      "id": "pancakes",
      "name": "Homemade pancakes (Krusteaz)",
      "items": [
        [
          "krusteaz",
          0.3
        ],
        [
          "butter",
          0.03
        ],
        [
          "syrup",
          0.1
        ],
        [
          "bananas",
          0.2
        ]
      ]
    },
    {
      "id": "swedish",
      "name": "Swedish pancakes",
      "items": [
        [
          "flour",
          0.08
        ],
        [
          "eggs",
          0.5
        ],
        [
          "milk",
          0.3
        ],
        [
          "butter",
          0.1
        ],
        [
          "jam",
          0.3
        ]
      ]
    }
  ],
  "lunches": [
    {
      "id": "pbj",
      "name": "PB&J & apple slices",
      "items": [
        [
          "bread",
          0.5
        ],
        [
          "pb",
          0.2
        ],
        [
          "jelly",
          0.1
        ],
        [
          "apples",
          0.25
        ]
      ]
    },
    {
      "id": "turkey",
      "name": "Turkey & cheese sandwiches",
      "items": [
        [
          "bread",
          0.5
        ],
        [
          "turkey",
          0.6
        ],
        [
          "cheddarSl",
          0.3
        ],
        [
          "apples",
          0.2
        ]
      ]
    },
    {
      "id": "leftovers",
      "name": "Dinner leftovers",
      "items": [],
      "note": "Best after soup, pasta and chicken nights"
    },
    {
      "id": "mac",
      "name": "Mac & cheese with peas",
      "items": [
        [
          "macCheese",
          2
        ],
        [
          "milk",
          0.05
        ],
        [
          "butter",
          0.03
        ],
        [
          "peasCarrots",
          0.5
        ]
      ]
    },
    {
      "id": "quesLunch",
      "name": "Cheese quesadillas & fruit",
      "items": [
        [
          "tortillas",
          0.5
        ],
        [
          "mexCheese",
          0.5
        ],
        [
          "clementines",
          0.15
        ]
      ]
    }
  ],
  "snacks": [
    "apples",
    "bananas",
    "clementines",
    "babyCarrots",
    "stringCheese",
    "goldfish",
    "pouches",
    "granolaBars",
    "pretzels",
    "popcorn"
  ],
  "defaults": {
    "plan": [
      "sweetPotato",
      "chickenSoup",
      "tacoSalad",
      "pastaSausage",
      "grilledChicken",
      "frozenPizza",
      "pancakes"
    ],
    "bf": {
      "cereal": 2,
      "frozen": 2,
      "frenchToast": 1,
      "pancakes": 1,
      "swedish": 1
    },
    "ln": {
      "pbj": 3,
      "turkey": 2,
      "leftovers": 2
    },
    "sn": {
      "apples": 1,
      "bananas": 1,
      "clementines": 0,
      "babyCarrots": 1,
      "stringCheese": 1,
      "goldfish": 1,
      "pouches": 1,
      "granolaBars": 2,
      "pretzels": 1,
      "popcorn": 0
    }
  }
};
