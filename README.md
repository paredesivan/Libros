# Mi biblioteca

Aplicación estática para GitHub Pages. Subir `index.html`, `styles.css` y `app.js` al repositorio `paredesivan.github.io`.

## Qué incluye

- Escaneo de ISBN con cámara en navegadores compatibles con `BarcodeDetector`.
- Carga manual de ISBN como respaldo.
- Datos de libros desde Open Library.
- Persistencia en `localStorage`.
- Exportación e importación de una copia JSON.
- Búsqueda tolerante por título, autor, ISBN, género y descripción.
- Filtros: todos, leyendo, por leer y favoritos.
- Página actual, progreso, estado, favoritos y notas.
- Recomendaciones según los géneros de la biblioteca, con búsquedas hacia Mercado Libre, Cúspide y SBS.

## Importante

La versión inicial guarda los datos en el navegador del dispositivo. No los comparte automáticamente entre teléfonos ni navegadores. Para una biblioteca sincronizada en la nube habría que agregar una base de datos y autenticación.
