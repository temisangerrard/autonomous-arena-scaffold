import { FURNITURE, HOME_ROOMS } from './furniture.js';
export function renderShop(container, life, onChange) {
  container.innerHTML =
    '<div class="shop-heading"><span>QUAYS & CO.</span><h3>A home, your way.</h3><p>Game money only. Instant delivery. Move owned pieces for free. Replaced pieces go into storage.</p></div><div id="shop-message" role="status"></div><div class="shop-grid"></div>';
  const grid = container.querySelector('.shop-grid');
  for (const item of FURNITURE) {
    const order = life.snapshot().furniture.find((o) => o.id === item.id);
    const card = document.createElement('article');
    card.className = 'shop-card';
    const preview = document.createElement('div');
    preview.className = `furniture-preview preview-${item.kind}`;
    preview.style.setProperty('--item-color', item.color);
    preview.setAttribute('aria-label', item.name + ' stylised preview');
    preview.innerHTML = '<i></i><b></b><em></em>';
    const title = document.createElement('h4');
    title.textContent = item.name;
    const detail = document.createElement('p');
    detail.textContent = item.description;
    const price = document.createElement('strong');
    price.textContent = order
      ? 'Owned · ' + (HOME_ROOMS[order.room] || 'In storage')
      : '£' + item.price.toLocaleString('en-GB');
    const select = document.createElement('select');
    select.id = 'room-' + item.id;
    select.setAttribute('aria-label', 'Room for ' + item.name);
    for (const id of item.rooms) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = HOME_ROOMS[id];
      select.append(option);
    }
    if (order) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Put in storage';
      select.append(option);
      select.value = order.room || '';
    }
    const button = document.createElement('button');
    button.dataset.purchase = item.id;
    button.textContent = order ? 'Place in selected room' : 'Buy & deliver';
    button.disabled = !order && life.snapshot().balance < item.price;
    button.onclick = () => {
      const result = order
        ? life.placeFurniture(item.id, select.value || null)
        : life.buyFurniture(item.id, select.value);
      const room = select.value;
      renderShop(container, life, onChange);
      onChange();
      container.querySelector('#shop-message').textContent = result.ok
        ? `${item.name} delivered to ${HOME_ROOMS[room] || 'storage'}.${life.snapshot().saved ? ' Saved on this device.' : ' Saving unavailable: this delivery lasts for this visit.'}`
        : result.reason;
    };
    card.append(preview, title, detail, price, select, button);
    grid.append(card);
  }
}
