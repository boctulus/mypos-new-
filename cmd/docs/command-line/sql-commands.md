# 🗃️ Comandos SQL

Documentación detallada para los comandos de SQL que permiten operaciones directas con bases de datos (MySQL, PostgreSQL, SQLite).

@author: Pablo Bozzolo <boctulus@gmail.com>

## 📋 Comandos Disponibles

### `find` - Buscar registro por ID
Busca un registro específico en una tabla usando su ID (primary key o campo id).

#### Uso
```bash
node com sql find <table> <id> [opciones]
```

#### Argumentos posicionales
- `<table>`: Nombre de la tabla donde buscar
- `<id>`: Valor del ID a buscar

#### Opciones
- `--connection`: Nombre de la conexión de base de datos (por defecto: 'main')
- `--id-field`: Campo a usar como ID (por defecto: 'id', detecta automáticamente la primary key si es posible)
- `--format`: Formato de salida (table, json, csv, line) (por defecto: 'json')

#### Ejemplos
```bash
# Buscar usuario con ID 1 (salida en formato JSON por defecto)
node com sql find users 1 --connection=main

# Buscar producto con ID específico
node com sql find products abc123 --connection=main

# Buscar usando un campo diferente como ID
node com sql find products sku123 --id-field=sku --connection=main

# Salida en formato tabla
node com sql find users 1 --connection=main --format=table

# Salida en formato JSON (predeterminado)
node com sql find users 1 --connection=main --format=json

# Salida en formato línea (con ID mostrado primero)
node com sql find users 1 --connection=main --format=line
```

---

### `find_by` - Buscar registros por campo y valor
Busca registros en una tabla usando una condición de igualdad campo=valor.

#### Uso
```bash
node com sql find_by <table> <field:value> [opciones]
```

#### Argumentos posicionales
- `<table>`: Nombre de la tabla donde buscar
- `<field:value>`: Condición en formato campo:valor

#### Opciones
- `--connection`: Nombre de la conexión de base de datos (por defecto: 'main')
- `--format`: Formato de salida (table, json, csv, line) (por defecto: 'json')

#### Ejemplos
```bash
# Buscar usuario por email (salida en formato JSON por defecto)
node com sql find_by users email:user@example.com --connection=main

# Buscar productos por categoría
node com sql find_by products category:electronics --connection=main

# Buscar órdenes por estado
node com sql find_by orders status:completed --connection=main

# Salida en formato tabla
node com sql find_by users email:user@example.com --connection=main --format=table

# Salida en formato CSV
node com sql find_by users email:user@example.com --connection=main --format=csv

# Salida en formato línea (con ID mostrado primero)
node com sql find_by users email:user@example.com --connection=main --format=line

# Salida en formato JSON (predeterminado)
node com sql find_by users email:user@example.com --connection=main --format=json
```

---

## 🔧 Configuración de Conexiones

Las conexiones a bases de datos se definen en `config/databases.config.js`. Ejemplo de configuración:

```javascript
export default {
  db_connections: {
    main: {
      driver: 'pgsql',        // 'mysql', 'pgsql', o 'sqlite'
      host: '127.0.0.1',
      port: 5432,
      db_name: 'mydb',
      user: 'username',
      pass: 'password',
      charset: 'utf8',
      schema: 'public'        // solo para PostgreSQL
    }
  },
  db_connection_default: 'main'
}
```

## 📊 Formatos de Salida

Ambos comandos soportan múltiples formatos de salida:

- `json`: Datos en formato JSON (por defecto)
- `line`: Líneas individuales con ID mostrado primero, seguido por otros campos en orden alfabético
- `table`: Tabla formateada en consola
- `csv`: Datos en formato CSV

## 🔍 Funcionalidades Avanzadas

### Detección Automática de Primary Key
El comando `find` puede detectar automáticamente el campo de primary key de una tabla en lugar de usar 'id' por defecto. Esto funciona para:
- MySQL
- PostgreSQL  
- SQLite

### Validación de Consultas
Todas las consultas SQL generadas por estos comandos son validadas para prevenir operaciones potencialmente destructivas.

## 🛠️ Casos de Uso Comunes

### Verificación de Datos
```bash
# Verificar si un usuario existe
node com sql find users 123

# Verificar productos en una categoría específica
node com sql find_by products category:electronics
```

### Debugging
```bash
# Ver todos los usuarios con un email específico
node com sql find_by users email:test@example.com --format=json

# Ver información detallada de un producto
node com sql find products abc123 --connection=main
```

### Integración con Scripts
```bash
# Exportar resultados a archivo
node com sql find_by users status:active --format=csv > active_users.csv
```

## ⚠️ Consideraciones de Seguridad

- Los comandos usan parámetros preparados para prevenir inyección SQL
- Solo se permiten operaciones de lectura (SELECT)
- Se recomienda usar cuentas de base de datos con permisos limitados