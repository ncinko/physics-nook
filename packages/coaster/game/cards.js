// Attraction card definitions and deck construction.

export const STARTER_CARDS = [
  {
    id: "american-eagle",
    name: "American Eagle",
    type: "coaster",
    subtype: "wood",
    footprint: 3,
    cost: { money: 8, wood: 5, steel: 0 },
    income: 6,
    reputation: 3,
    prestige: 6,
    text: "Wooden coaster. Forest placement reduces wood cost by 1."
  },
  {
    id: "top-thrill-dragster",
    name: "Top Thrill Dragster",
    type: "coaster",
    subtype: "steel",
    footprint: 2,
    cost: { money: 10, wood: 0, steel: 6 },
    income: 7,
    reputation: 4,
    prestige: 8,
    text: "Steel launch coaster. The fastest ride in the park."
  },
  {
    id: "carousel",
    name: "Carousel",
    type: "ride",
    subtype: "family",
    footprint: 1,
    cost: { money: 4, wood: 1, steel: 0 },
    income: 3,
    reputation: 1,
    prestige: 2,
    text: "A reliable family ride."
  },
  {
    id: "scrambler",
    name: "Scrambler",
    type: "ride",
    subtype: "thrill",
    footprint: 1,
    cost: { money: 5, wood: 0, steel: 1 },
    income: 4,
    reputation: 1,
    prestige: 2,
    text: "Compact thrill ride."
  },
  {
    id: "food-stall",
    name: "Food Stall",
    type: "shop",
    subtype: "food",
    footprint: 1,
    cost: { money: 3, wood: 0, steel: 0 },
    income: 2,
    reputation: 0,
    prestige: 1,
    text: "Simple shop income."
  },
  {
    id: "gift-shop",
    name: "Gift Shop",
    type: "shop",
    subtype: "retail",
    footprint: 1,
    cost: { money: 4, wood: 0, steel: 0 },
    income: 2,
    reputation: 1,
    prestige: 1,
    text: "Small reputation boost."
  },
  {
    id: "ferris-wheel",
    name: "Ferris Wheel",
    type: "ride",
    subtype: "family",
    footprint: 2,
    cost: { money: 7, wood: 0, steel: 3 },
    income: 4,
    reputation: 3,
    prestige: 5,
    text: "Large scenic ride."
  },
  {
    id: "wooden-mouse",
    name: "Wooden Mouse",
    type: "coaster",
    subtype: "wood",
    footprint: 2,
    cost: { money: 6, wood: 3, steel: 0 },
    income: 5,
    reputation: 2,
    prestige: 4,
    text: "Small wooden coaster. Forest placement reduces wood cost by 1."
  },
  {
    id: "splash-boats",
    name: "Splash Boats",
    type: "ride",
    subtype: "water",
    footprint: 1,
    cost: { money: 6, wood: 0, steel: 0 },
    income: 4,
    reputation: 2,
    prestige: 4,
    water: true,
    text: "Water ride. The only attraction that can be built on a water tile. No wood or steel."
  }
];

export const CARDS_BY_ID = Object.fromEntries(STARTER_CARDS.map((c) => [c.id, c]));

// Copies per card id — roughly 30 cards total, weighted toward cheap attractions.
const DECK_COUNTS = {
  "american-eagle": 3,
  "top-thrill-dragster": 3,
  carousel: 4,
  scrambler: 4,
  "food-stall": 5,
  "gift-shop": 4,
  "ferris-wheel": 3,
  "wooden-mouse": 4,
  "splash-boats": 3
};

export function buildDeck() {
  const deck = [];
  for (const [cardId, count] of Object.entries(DECK_COUNTS)) {
    for (let i = 0; i < count; i++) deck.push(cardId);
  }
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function abbreviate(card) {
  return card.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
