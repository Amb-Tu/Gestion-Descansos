# Gestión de Descansos (SQL)

Proyecto web simple para gestionar descansos de personal sin registro.  
Incluye cola automática y persistencia con base de datos SQL (SQLite).

## Requisitos

- Node.js 18+ (recomendado)

## Instalación

```bash
npm install
```

## Ejecutar en local

```bash
npm start
```

Luego abre: `http://localhost:3000`

## Cómo funciona

- **Descanso**: máximo 3 personas a la vez.
- **Espera**: cola ilimitada.
- Cuando la hora llega y hay cupo, aparece **Confirmar inicio**.
- El descanso empieza a contar desde la confirmación.
- Cada persona puede finalizar/cancelar su estado o actualizar datos.

## Base de datos

- SQLite, archivo `descansos.db` en la raíz del proyecto.
- Esquema disponible en `db.sql`.

## Archivos principales

- `index.html` UI
- `styles.css` estilos
- `script.js` frontend (consume API)
- `server.js` backend + SQLite
- `db.sql` esquema SQL
- `AMBTU_logo.svg` logo del footer

## Subir a servidor

1. Clonar repo
2. `npm install`
3. `npm start`
4. Servidor: `http://localhost:3000`

Si necesitas correrlo con otro puerto:

```bash
set PORT=4000
npm start
```
