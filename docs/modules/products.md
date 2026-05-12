# Módulo: Products

## Archivos

| Archivo | Rol |
|---|---|
| `api/dto/ProductDto.kt` | DTO de respuesta + mapper a `model/Product` |
| `repository/ProductRepository.kt` | `getAll()` y `searchQuick(query)` |
| `compose/viewmodel/InventoryViewModel.kt` | Carga y filtrado de inventario |
| `compose/screen/InventoryScreen.kt` | UI inventario — consume `InventoryViewModel` |
| `ui/sales/SalesCalculatorViewModel.kt` | Estado de búsqueda modal (results/loading/error) |
| `compose/screen/SalesCalculatorScreen.kt` | Modal `ProductSearchModal` — consume estado del ViewModel |

---

## Endpoints

```
GET /api/products                       ← carga completa (Inventario)
GET /api/products/search/quick?q={q}   ← búsqueda rápida (modal Calculadora)
```

Requiere sesión activa (cookie). El `store_id` lo resuelve el backend desde la sesión — no se envía en la request Android.

Respuesta:
```json
{
  "success": true,
  "products": [...],
  "total": 15
}
```

---

## Mapeo de campos crítico

El backend usa `description` como nombre del producto. El modelo Android usa `name`.

| Backend | Android `Product` |
|---|---|
| `description` | `name` |
| `brand` | `description` |
| `ean13` | `barcode` |
| `stock` (Double) | `stock` (Int) |
| `category` | `category` |
| `price` | `price` |

Mapper en `ProductDto.toProduct()`.

---

## Comportamiento del modal

- Query vacío → lista vacía, muestra "Escriba para buscar productos". No llama a la API.
- Query con contenido → debounce 300ms → llama `/search/quick`. Cancela el job anterior si el usuario sigue escribiendo.
- X en el campo → limpia query + cancela búsqueda pendiente.
- Cerrar modal → `clearProductSearch()` en ViewModel → resetea todo el estado.

---

## Restricciones

- `searchQuick` filtra solo productos activos (`is_active: true` forzado en backend).
- Máximo 15 resultados por búsqueda (límite del endpoint).
- La búsqueda NO funciona offline — no hay fallback local.
