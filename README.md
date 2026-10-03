# GMAO · Analítica de mantenimiento

Aplicación estática para analizar exportaciones CSV de GMAO/CMMS. No requiere backend, cuenta de usuario ni instalación: los datos se procesan en el navegador y no se envían a ningún servicio.

**Creador:** Marcelo Cisternas Fernández.

## Uso

1. Publica el repositorio con GitHub Pages y abre `webapp/`. Se carga automáticamente `data/CMMS_grupo_A.csv`.
2. Selecciona **Cargar dataset** o arrastra un CSV a la barra de filtros para analizar otro grupo.
3. Filtra por tipo de mantenimiento y período. Los indicadores, gráficos y tablas se recalculan.
4. Pulsa **Exportar informe PDF** y elige **Guardar como PDF** en el diálogo de impresión.

La carga automática del dataset requiere HTTP/HTTPS. Al abrir `index.html` como archivo local, usa el selector de archivos para cargar un CSV.

## Estructura esperada

Se admiten archivos CSV con separador coma o punto y coma, con encabezados CMMS. Para calcular el panel se requieren:

`OT`, `Tipo_mantenimiento`, `Equipo`, `Tipo_equipo`, `Criticidad`, `Modo_falla`, `Estado`, `Downtime_h`, `Horas_mano_obra`, `Costo_total_CLP`, `Fecha_inicio` y `Fecha_fin`.

Las fechas de inicio y término admiten `dd-mm-aaaa hh:mm` y variantes ISO. Las filas exactamente duplicadas se excluyen como en el notebook `GMAO_local`.

## Metodología

- Las OT se cuentan por identificador único.
- MTTR y mediana consideran órdenes correctivas cerradas con fechas válidas y duración positiva calculada entre inicio y término.
- El Jack-Knife compara la frecuencia media de fallas y el downtime medio por falla. El riesgo relativo se presenta como `R*`.
- El informe imprimible reúne portada ejecutiva, KPIs, comparativos, paretos, mantenibilidad y tablas de criticidad; no requiere XeLaTeX.

## GitHub Pages

La ruta al dataset es relativa (`./data/CMMS_grupo_A.csv`), por lo que funciona tanto en la raíz como en un repositorio publicado bajo una subruta. Para publicar solamente esta aplicación, configura una GitHub Actions workflow de Pages para desplegar la carpeta `webapp`.
