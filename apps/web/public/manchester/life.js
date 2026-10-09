import { FURNITURE } from './furniture.js';
export const DECOR = [
  { id: 'plant', name: 'A leafy corner' },
  { id: 'lamp', name: 'Warm floor lamp' },
  { id: 'rug', name: 'Woven sunset rug' },
  { id: 'sofa', name: 'Velvet green sofa' },
];
export const REWARDS = {
  run: { name: 'Golden Mile jacket', color: '#d8ad50' },
  rowing: { name: 'Sunset cruise access' },
  penalties: { name: 'Old Trafford sharpshooter badge' },
  rhythm: { name: 'After-hours violet jacket', color: '#8659a4' },
  'canal-lock': { name: 'Quays Captain title' },
};
const KEY = 'manchester-life-v1';
export function createLife(storage) {
  let state = {
      version: 2,
      balance: 250000,
      energy: 100,
      hunger: 80,
      owned: DECOR.map((d) => d.id),
      achievements: [],
      hiddenDecor: [],
      furniture: [],
    },
    saved = true;
  try {
    const value = JSON.parse(storage?.getItem(KEY) || 'null');
    if (value && typeof value === 'object') {
      if (
        Number.isSafeInteger(value.balance) &&
        value.balance >= 0 &&
        value.balance <= 1000000
      )
        state.balance =
          value.version === 2 ? value.balance : Math.max(250000, value.balance);
      for (const key of ['energy', 'hunger'])
        if (Number.isFinite(value[key]))
          state[key] = Math.max(0, Math.min(100, value[key]));
      if (Array.isArray(value.furniture)) {
        const seen = new Set();
        state.furniture = value.furniture
          .filter((order) => {
            const item = FURNITURE.find((i) => i.id === order?.id);
            if (
              !item ||
              (order.room !== null && !item.rooms.includes(order.room)) ||
              seen.has(order.id)
            )
              return false;
            seen.add(order.id);
            return true;
          })
          .map(({ id, room }) => ({ id, room }));
      }
      if (Array.isArray(value.achievements))
        state.achievements = [
          ...new Set(
            value.achievements.filter((k) => Object.hasOwn(REWARDS, k))
          ),
        ];
      if (Array.isArray(value.hiddenDecor))
        state.hiddenDecor = [
          ...new Set(
            value.hiddenDecor.filter((k) => DECOR.some((d) => d.id === k))
          ),
        ];
    }
  } catch {
    saved = false;
  }
  const listeners = new Set();
  function persist() {
    try {
      storage?.setItem(KEY, JSON.stringify(state));
      saved = Boolean(storage);
    } catch {
      saved = false;
    }
    listeners.forEach((fn) => fn());
  }
  function clearSlot(item, room) {
    if (room === null) return;
    for (const order of state.furniture) {
      if (
        order.id !== item.id &&
        order.room === room &&
        FURNITURE.find((i) => i.id === order.id)?.kind === item.kind
      )
        order.room = null;
    }
  }
  persist();
  return {
    buyFurniture(id, room) {
      const item = FURNITURE.find((i) => i.id === id);
      if (!item || !item.rooms.includes(room))
        return { ok: false, reason: 'Choose a suitable room.' };
      if (state.furniture.some((o) => o.id === id))
        return {
          ok: false,
          reason: 'Already owned. You can move it for free.',
        };
      if (state.balance < item.price)
        return { ok: false, reason: 'Not enough game money.' };
      state.balance -= item.price;
      clearSlot(item, room);
      state.furniture.push({ id, room });
      persist();
      return { ok: true };
    },
    placeFurniture(id, room) {
      const item = FURNITURE.find((i) => i.id === id),
        order = state.furniture.find((o) => o.id === id);
      if (!item || !order || (room !== null && !item.rooms.includes(room)))
        return { ok: false, reason: 'Choose a suitable room.' };
      clearSlot(item, room);
      order.room = room;
      persist();
      return { ok: true };
    },
    toggleDecor(id) {
      if (!state.owned.includes(id)) return;
      state.hiddenDecor = state.hiddenDecor.includes(id)
        ? state.hiddenDecor.filter((k) => k !== id)
        : [...state.hiddenDecor, id];
      persist();
    },
    snapshot: () => ({
      ...state,
      owned: [...state.owned],
      furniture: state.furniture.map((o) => ({ ...o })),
      achievements: [...state.achievements],
      hiddenDecor: [...state.hiddenDecor],
      saved,
    }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reward(type) {
      if (!Object.hasOwn(REWARDS, type) || state.achievements.includes(type))
        return null;
      state.achievements.push(type);
      state.energy = Math.max(0, state.energy - 8);
      state.hunger = Math.max(0, state.hunger - 5);
      persist();
      return REWARDS[type].name;
    },
    cook() {
      if (state.hunger >= 100)
        return { ok: false, reason: 'You’re already full.' };

      state.hunger = Math.min(100, state.hunger + 35);
      persist();
      return { ok: true };
    },
    rest() {
      state.energy = Math.min(100, state.energy + 35);
      persist();
    },
    relax() {
      state.energy = Math.min(100, state.energy + 15);
      persist();
    },
  };
}
