export type FoodConcept = Readonly<{
  id: string;
  name: string;
  category: string;
  aliases: readonly string[];
}>;

const defineConcept = (
  id: string,
  name: string,
  category: string,
  aliases: readonly string[] = [],
): FoodConcept => ({ id, name, category, aliases });

/**
 * The deliberately small v1 vocabulary used by both inventory normalization and
 * the source-controlled recipe corpus. IDs are stable application identifiers;
 * external database IDs can be mapped later without changing recipe records.
 */
export const FOOD_CONCEPTS = [
  defineConcept("water", "water", "Staples"),
  defineConcept("salt", "salt", "Spices", ["table salt", "kosher salt", "sea salt"]),
  defineConcept("black-pepper", "black pepper", "Spices", ["pepper", "ground pepper"]),
  defineConcept("olive-oil", "olive oil", "Oils", ["extra virgin olive oil", "evoo"]),
  defineConcept("vegetable-oil", "vegetable oil", "Oils", ["neutral oil", "canola oil"]),
  defineConcept("butter", "butter", "Dairy", ["unsalted butter", "salted butter"]),
  defineConcept("sugar", "sugar", "Baking", ["white sugar", "granulated sugar"]),
  defineConcept("brown-sugar", "brown sugar", "Baking", ["light brown sugar", "dark brown sugar"]),
  defineConcept("honey", "honey", "Condiments"),
  defineConcept("maple-syrup", "maple syrup", "Condiments"),
  defineConcept("vinegar", "vinegar", "Condiments", ["white vinegar", "apple cider vinegar", "red wine vinegar"]),
  defineConcept("soy-sauce", "soy sauce", "Condiments", ["tamari"]),
  defineConcept("mustard", "mustard", "Condiments", ["yellow mustard", "dijon mustard"]),
  defineConcept("mayonnaise", "mayonnaise", "Condiments", ["mayo"]),
  defineConcept("hot-sauce", "hot sauce", "Condiments"),
  defineConcept("salsa", "salsa", "Condiments"),
  defineConcept("pesto", "pesto", "Condiments", ["basil pesto"]),
  defineConcept("marinara-sauce", "marinara sauce", "Condiments", ["pasta sauce", "tomato sauce"]),
  defineConcept("tomato-paste", "tomato paste", "Canned Goods"),
  defineConcept("vegetable-broth", "vegetable broth", "Canned Goods", ["vegetable stock", "veggie broth"]),
  defineConcept("chicken-broth", "chicken broth", "Canned Goods", ["chicken stock"]),
  defineConcept("beef-broth", "beef broth", "Canned Goods", ["beef stock"]),
  defineConcept("coconut-milk", "coconut milk", "Canned Goods"),
  defineConcept("peanut-butter", "peanut butter", "Condiments"),
  defineConcept("baking-powder", "baking powder", "Baking"),
  defineConcept("baking-soda", "baking soda", "Baking", ["bicarbonate of soda"]),
  defineConcept("vanilla", "vanilla extract", "Baking", ["vanilla"]),
  defineConcept("cinnamon", "cinnamon", "Spices", ["ground cinnamon"]),
  defineConcept("cumin", "cumin", "Spices", ["ground cumin"]),
  defineConcept("chili-powder", "chili powder", "Spices"),
  defineConcept("paprika", "paprika", "Spices", ["smoked paprika"]),
  defineConcept("oregano", "oregano", "Spices", ["dried oregano"]),
  defineConcept("basil", "basil", "Herbs", ["fresh basil", "dried basil"]),
  defineConcept("thyme", "thyme", "Herbs", ["fresh thyme", "dried thyme"]),
  defineConcept("curry-powder", "curry powder", "Spices"),
  defineConcept("sesame-oil", "sesame oil", "Oils", ["toasted sesame oil"]),
  defineConcept("eggs", "eggs", "Protein", ["egg", "large egg", "large eggs"]),
  defineConcept("chicken-breast", "chicken breast", "Protein", ["chicken breasts", "boneless chicken breast"]),
  defineConcept("chicken-thigh", "chicken thigh", "Protein", ["chicken thighs", "boneless chicken thigh"]),
  defineConcept("ground-beef", "ground beef", "Protein", ["minced beef", "beef mince"]),
  defineConcept("beef-steak", "beef steak", "Protein", ["steak"]),
  defineConcept("pork-chop", "pork chop", "Protein", ["pork chops"]),
  defineConcept("pork-tenderloin", "pork tenderloin", "Protein"),
  defineConcept("bacon", "bacon", "Protein"),
  defineConcept("sausage", "sausage", "Protein", ["sausages", "Italian sausage"]),
  defineConcept("salmon", "salmon", "Protein", ["salmon fillet", "salmon fillets"]),
  defineConcept("tuna", "tuna", "Protein", ["canned tuna", "tuna fish"]),
  defineConcept("shrimp", "shrimp", "Protein", ["prawns", "prawn"]),
  defineConcept("tofu", "tofu", "Protein", ["firm tofu", "extra firm tofu"]),
  defineConcept("chickpeas", "chickpeas", "Legumes", ["chickpea", "garbanzo beans", "garbanzo bean"]),
  defineConcept("black-beans", "black beans", "Legumes", ["black bean"]),
  defineConcept("kidney-beans", "kidney beans", "Legumes", ["kidney bean"]),
  defineConcept("white-beans", "white beans", "Legumes", ["white bean", "cannellini beans", "navy beans"]),
  defineConcept("lentils", "lentils", "Legumes", ["lentil", "brown lentils", "green lentils", "red lentils"]),
  defineConcept("rice", "rice", "Grains", ["white rice", "long grain rice", "jasmine rice"]),
  defineConcept("brown-rice", "brown rice", "Grains"),
  defineConcept("quinoa", "quinoa", "Grains"),
  defineConcept("pasta", "pasta", "Grains", ["spaghetti", "penne", "macaroni", "rotini", "linguine"]),
  defineConcept("noodles", "noodles", "Grains", ["noodle", "egg noodles", "ramen noodles"]),
  defineConcept("oats", "oats", "Grains", ["rolled oats", "old fashioned oats", "oatmeal"]),
  defineConcept("bread", "bread", "Bakery", ["sandwich bread", "whole wheat bread", "toast"]),
  defineConcept("tortillas", "tortillas", "Bakery", ["tortilla", "flour tortillas", "corn tortillas"]),
  defineConcept("flour", "flour", "Baking", ["all purpose flour", "plain flour"]),
  defineConcept("cornmeal", "cornmeal", "Grains"),
  defineConcept("couscous", "couscous", "Grains"),
  defineConcept("barley", "barley", "Grains", ["pearl barley"]),
  defineConcept("milk", "milk", "Dairy", ["whole milk", "skim milk", "2 percent milk"]),
  defineConcept("cheddar", "cheddar cheese", "Dairy", ["cheddar", "shredded cheddar"]),
  defineConcept("mozzarella", "mozzarella cheese", "Dairy", ["mozzarella", "shredded mozzarella"]),
  defineConcept("parmesan", "parmesan cheese", "Dairy", ["parmesan", "grated parmesan"]),
  defineConcept("yogurt", "yogurt", "Dairy", ["plain yogurt", "greek yogurt"]),
  defineConcept("cream-cheese", "cream cheese", "Dairy"),
  defineConcept("sour-cream", "sour cream", "Dairy"),
  defineConcept("heavy-cream", "heavy cream", "Dairy", ["whipping cream"]),
  defineConcept("onion", "onion", "Produce", ["onions", "yellow onion", "red onion", "white onion"]),
  defineConcept("garlic", "garlic", "Produce", ["garlic clove", "garlic cloves"]),
  defineConcept("tomato", "tomato", "Produce", ["tomatoes", "fresh tomato", "fresh tomatoes"]),
  defineConcept("canned-tomato", "canned tomatoes", "Canned Goods", ["canned tomato", "diced tomatoes", "crushed tomatoes"]),
  defineConcept("bell-pepper", "bell pepper", "Produce", ["bell peppers", "red pepper", "green pepper"]),
  defineConcept("jalapeno", "jalapeno", "Produce", ["jalapeno pepper", "jalapeño"]),
  defineConcept("potato", "potato", "Produce", ["potatoes", "russet potato", "red potato"]),
  defineConcept("sweet-potato", "sweet potato", "Produce", ["sweet potatoes", "yam", "yams"]),
  defineConcept("carrot", "carrot", "Produce", ["carrots"]),
  defineConcept("celery", "celery", "Produce", ["celery stalk", "celery stalks"]),
  defineConcept("broccoli", "broccoli", "Produce", ["broccoli florets"]),
  defineConcept("cauliflower", "cauliflower", "Produce", ["cauliflower florets"]),
  defineConcept("spinach", "spinach", "Produce", ["baby spinach"]),
  defineConcept("kale", "kale", "Produce"),
  defineConcept("lettuce", "lettuce", "Produce", ["romaine", "romaine lettuce"]),
  defineConcept("cabbage", "cabbage", "Produce", ["green cabbage", "red cabbage"]),
  defineConcept("zucchini", "zucchini", "Produce", ["courgette", "courgettes"]),
  defineConcept("mushroom", "mushrooms", "Produce", ["mushroom", "button mushrooms"]),
  defineConcept("corn", "corn", "Produce", ["corn kernels", "sweet corn"]),
  defineConcept("peas", "peas", "Produce", ["green peas", "pea"]),
  defineConcept("green-beans", "green beans", "Produce", ["green bean", "string beans"]),
  defineConcept("cucumber", "cucumber", "Produce", ["cucumbers"]),
  defineConcept("avocado", "avocado", "Produce", ["avocados"]),
  defineConcept("lemon", "lemon", "Produce", ["lemons", "lemon juice"]),
  defineConcept("lime", "lime", "Produce", ["limes", "lime juice"]),
  defineConcept("apple", "apple", "Produce", ["apples"]),
  defineConcept("banana", "banana", "Produce", ["bananas"]),
  defineConcept("berries", "berries", "Produce", ["berry", "mixed berries", "blueberries", "strawberries"]),
  defineConcept("orange", "orange", "Produce", ["oranges", "orange juice"]),
] as const satisfies readonly FoodConcept[];

export const FOOD_CONCEPT_BY_ID: ReadonlyMap<string, FoodConcept> = new Map(
  FOOD_CONCEPTS.map((concept) => [concept.id, concept]),
);

/** Suggested defaults only. Households persist and edit their own staple list. */
export const DEFAULT_STAPLE_CONCEPT_IDS = [
  "water",
  "salt",
  "black-pepper",
  "vegetable-oil",
] as const;

export function getFoodConcept(id: string): FoodConcept | undefined {
  return FOOD_CONCEPT_BY_ID.get(id);
}
