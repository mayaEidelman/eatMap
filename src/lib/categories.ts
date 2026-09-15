import { PLACE_CATEGORIES, type PlaceCategory } from '../types';

export const CATEGORY_META: Record<PlaceCategory, { label: string; icon: string }> = {
  food: { label: 'Food', icon: '🍴' },
  attraction: { label: 'Attraction', icon: '📍' },
  hotel: { label: 'Hotel', icon: '🛏️' },
  cafe: { label: 'Cafe', icon: '☕' },
  shopping: { label: 'Shopping', icon: '🛍️' },
  nature: { label: 'Nature', icon: '🌿' },
  nightlife: { label: 'Nightlife', icon: '🌙' },
  other: { label: 'Other', icon: '📌' },
};

export function guessCategoryFromTypes(types: string[] | undefined): PlaceCategory {
  const list = types ?? [];
  const has = (type: string) => list.includes(type);

  if (has('lodging')) return 'hotel';
  if (has('cafe') || has('bakery')) return 'cafe';
  if (has('restaurant') || has('meal_takeaway') || has('meal_delivery') || has('food')) return 'food';
  if (has('night_club') || has('bar')) return 'nightlife';
  if (has('shopping_mall') || has('store') || has('clothing_store') || has('supermarket')) return 'shopping';
  if (has('park') || has('natural_feature') || has('campground') || has('zoo')) return 'nature';
  if (has('tourist_attraction') || has('museum') || has('art_gallery') || has('point_of_interest')) return 'attraction';
  return 'other';
}

export function groupPlacesByCategory<T extends { category: PlaceCategory }>(places: T[]) {
  const map = new Map<PlaceCategory, T[]>();
  places.forEach((place) => {
    const list = map.get(place.category) ?? [];
    list.push(place);
    map.set(place.category, list);
  });

  return PLACE_CATEGORIES.filter((category) => map.has(category)).map((category) => ({
    category,
    places: map.get(category) as T[],
  }));
}
