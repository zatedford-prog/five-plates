import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, linesFromText } from '../src/recipe.js';

test('ingredient lines become a search term and a package guess', () => {
  const cheese = parseLine('2 cups shredded cheddar cheese');
  assert.equal(cheese.term, 'cheddar cheese');
  assert.equal(cheese.qty, 1);
  const chicken = parseLine('1 1/2 pounds boneless skinless chicken breasts, cut into cubes');
  assert.equal(chicken.term, 'chicken breasts');
  assert.equal(chicken.qty, 1.5);
  assert.equal(parseLine('1 (15 oz) can black beans, drained and rinsed').term, 'black beans');
  assert.equal(parseLine('3 cloves garlic, minced').qty, 0.25);
});

test('pantry basics start as "have it"; water is skipped; flour tortillas are not pantry', () => {
  assert.equal(parseLine('½ teaspoon kosher salt').pantry, true);
  assert.equal(parseLine('1 tablespoon olive oil').pantry, true);
  assert.equal(parseLine('1 cup warm water').skip, true);
  assert.equal(parseLine('8 small flour tortillas').pantry, false);
});

test('pasted text drops bullets and numbering but keeps amounts', () => {
  assert.deepEqual(linesFromText('- 2 cups rice\n• 1 lb ground beef\n3. 1 onion\n\n2 cans tomatoes'),
    ['2 cups rice', '1 lb ground beef', '1 onion', '2 cans tomatoes']);
});
