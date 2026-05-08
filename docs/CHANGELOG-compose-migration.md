# Compose Migration — Legacy Screens

> Fecha: 2026-05-08

---

## Alcance

Migración gradual de 5 pantallas legacy a Jetpack Compose.

---

## Archivos Creados

| Archivo | Propósito |
|---|---|
| `compose/screen/HomeScreen.kt` | Grid 2x2 de tiles de navegación |
| `compose/screen/SalesCalculatorScreen.kt` | Calculadora de venta con teclado numérico |
| `compose/screen/CartScreen.kt` | Carrito de compras con lista de items |
| `compose/screen/BillingScreen.kt` | Selección de tipo de documento tributario |
| `compose/screen/CashPaymentScreen.kt` | Ingreso de pago en efectivo |
| `compose/components/CalcKeypad.kt` | Teclados reutilizables: `SalesCalcKeypad` y `CashPaymentKeypad` |

---

## Archivos Modificados

| Archivo | Cambio |
|---|---|
| `ui/home/HomeFragment.kt` | Reemplazado con ComposeView host → `HomeScreen` |
| `ui/sales/SalesCalculatorFragment.kt` | Reemplazado con ComposeView host → `SalesCalculatorScreen` |
| `ui/cart/CartFragment.kt` | Reemplazado con ComposeView host → `CartScreen` |
| `BillingActivity.kt` | `setContentView` → `setContent {}` → `BillingScreen` |
| `CashPaymentActivity.kt` | `setContentView` → `setContent {}` → `CashPaymentScreen` |

---

## Arquitectura Aplicada

### Patrón Fragment Host

```
Fragment.onCreateView() {
    return ComposeView(context).apply {
        setViewCompositionStrategy(DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            Screen(
                viewModel = ViewModelProvider(requireActivity()).get(...),
                onNavigate = { findNavController().navigate(...) }
            )
        }
    }
}
```

### Patrón Activity Host

```
Activity.onCreate() {
    setContent {
        Screen(
            param = intent.getExtra(...),
            onConfirm = { result -> setResult(RESULT_OK); finish() }
        )
    }
}
```

### ViewModel Compartido (SalesCalculator + Cart)

Preservado: ambos fragmentos usan `ViewModelProvider(requireActivity())` → misma instancia. El ViewModel se pasa como parámetro al Screen composable. No se usa `viewModel()` de Compose para evitar scope diferente.

### LiveData → Compose State

```kotlin
val currentAmount by viewModel.currentAmount.observeAsState("0")
```

Requiere `androidx.compose.runtime:runtime-livedata` (ya en dependencias).

---

## XML a Remover (pendiente — cuando screens sean estables)

| Layout XML | Reemplazado por |
|---|---|
| `fragment_home.xml` | `HomeScreen.kt` |
| `screen_sales_calc.xml` | `SalesCalculatorScreen.kt` |
| `keyboard_calc_variant_clear_comma.xml` | `SalesCalcKeypad` composable |
| `fragment_cart.xml` | `CartScreen.kt` |
| `item_cart_product.xml` | `SaleItemRow` composable |
| `activity_billing.xml` | `BillingScreen.kt` |
| `activity_cash_payment.xml` | `CashPaymentScreen.kt` |

---

## Código Legacy Muerto (identificado, NO eliminado)

| Archivo | Razón |
|---|---|
| `ui/dashboard/DashboardAdapter.kt` | `HomeFragment` ya no usa RecyclerView |
| `ui/home/HomeViewModel.kt` | Nunca fue usado por `HomeFragment` |
| `ui/sales/SaleItemAdapter.kt` | `CartFragment` ya no usa RecyclerView (nota: file en `ui/sales/` con package `ui/cart/` — inconsistencia preexistente) |
| `ui/payments/PaymentCancellationDialog.kt` | `CashPaymentActivity` ahora usa `AlertDialog` de Compose |
| `fragment_cart_item_update.xml` | No referenciado en ningún archivo |
| `modal_cash_*.xml` (×4) | Modales de CashPayment no referenciados en el flujo actual |

---

## Riesgos y Deuda Técnica

### Riesgos

| Riesgo | Severidad | Detalle |
|---|---|---|
| `startActivityForResult` deprecado | Baja | `SalesCalculatorFragment` aún lo usa; migrará con Activity Result API |
| `requireActivity().onBackPressed()` deprecado | Baja | `CartFragment`; migrar a `OnBackPressedDispatcher` |
| ViewModel scope en `CashPaymentActivity` | Media | `ViewModelProvider(this)` crea instancia separada a la de `MainActivity`; `clearCart()` en cancelación no afecta el carrito real — bug preexistente preservado |
| Sin `MaterialTheme` wrapper en Activities | Baja | `BillingActivity` y `CashPaymentActivity` usan tokens Material3 por defecto baseline; colores pueden diferir del tema de la app |
| `AlertDialog` de AppCompat en `SalesCalculatorFragment` | Baja | Mix de View-system dialog con Compose; funcional pero inconsistente |

### Deuda Técnica

- `SalesCalculatorViewModel` usa `LiveData`, no `StateFlow`. Migrar a StateFlow para mejor integración Compose.
- `SalesCalculatorScreen`: sin Toast cuando carrito vacío al presionar PAGAR (regresión menor del original).
- Cart search bar visual pero no funcional (igual que el original).
- `BillingScreen`: el botón "Confirmar" y la navegación back hacen lo mismo (comportamiento del original preservado).
- `processSale()` en ViewModel tiene posible bug: `_currentAmount.value?.toIntOrNull()` sobre un String que puede contener `"x"` (bug preexistente, no modificado).

---

## Mejoras Futuras Recomendadas

1. **Migrar LiveData → StateFlow** en `SalesCalculatorViewModel` para eliminar `observeAsState` y usar `collectAsState`.
2. **Activity Result API** reemplazar `startActivityForResult` / `onActivityResult` con `rememberLauncherForActivityResult`.
3. **MaterialTheme unificado** — Crear un `FriendlyPosTheme` composable y aplicarlo en todos los hosts (Fragments y Activities).
4. **CartScreen search funcional** — Añadir `searchQuery: StateFlow<String>` al ViewModel (o uno nuevo).
5. **Eliminar SaleItemAdapter y DashboardAdapter** — Ya no se usan; limpiar en próxima iteración.
6. **Fix ViewModel scope en CashPaymentActivity** — Recibir `totalAmount` y retornar resultado sin acceder a ViewModel de la otra Activity.
7. **Preparar para Repository layer** — `SalesCalculatorViewModel.processSale()` es el punto de entrada para la futura llamada `POST /api/sales`.
