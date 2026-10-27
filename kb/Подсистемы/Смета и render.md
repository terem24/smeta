---
tags: [подсистема]
файлы: app.js, catalog.js, index.html
---
# Смета: `app.render()`

- `app.state` → `localStorage['stout_save']`; `saveState()` → автосохранение в Supabase (PRO, дебаунс 3 с, не чаще раза в 15 мин).
- `render()` считает `getHouseHeatLoss()`, перебирает каталог, строит `currentEquipmentList` / `currentWorksList`.
- Позиция в смету: `addToBill(item, qty, desc, group)`; группу закрывает `flushBill(sectionTitle)` (подмешивает `state.userAddedEq`).
- Строки одного артикула склеиваются под ключом первой; ручные замены — `state.swaps` под `originalId` первой строки.
- Шаринг: `compactPayload()` → `encodePayload()` (deflate + base64) в URL.
- Искать в коде по имени функции (`render: function`), а не по номеру строки.

Связано: [[Теплопотери]], [[Стыковка обвязки]], [[Бренды и каталог]].
