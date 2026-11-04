<p align="center">
  <img src="public/pulso-logo.jpg" alt="Pulso" width="96">
</p>

<h1 align="center">Pulso</h1>

<p align="center">
  Estudio para el entrenador personal.<br>
  Agenda, clientes, rutinas, alimentación y el cobro de cada mes.
</p>

<p align="center">
  <img src="docs/capturas/inicio.png" alt="Inicio de Pulso" width="460">
</p>

## Módulos

| Módulo | Qué hace |
| --- | --- |
| Inicio | El día, lo que falta por cobrar y los servicios |
| Agenda | La semana, la cita hecha o cancelada, y el horario de atención |
| Reservar | Servicio, día y hora libre. Si el teléfono ya existe, usa ese cliente |
| Clientes | Búsqueda, cliente nuevo y ficha |
| Rutina | Días, ejercicios, series, repeticiones y plantillas |
| Comidas | Tabla por momento del día. Es una guía del entrenador |
| Pagos | Mensualidad y valoración del mes, más un cobro suelto si hace falta |

## Cobro

Cada cliente paga dos cosas todos los meses, por separado:

- la **mensualidad**
- la **valoración** de ese mes

En la ficha, pestaña Pagos, se escriben los dos valores y se generan los cobros. Si el mes ya está, no se duplica.

## Correr el proyecto

```bash
npm install
npm start
```

Abre `http://localhost:4200`. En el celular, en la misma red, usa la dirección que muestra la consola.

## Cómo está armado

```text
src/app
├── inicio/      día y servicios
├── agenda/      semana y horario
├── reserva/     cita nueva
├── clientes/    lista
├── ficha/       datos, rutina, comidas y pagos
├── modelos.ts   los datos
└── pulso.service.ts
```

La pantalla cabe en 720 px y la barra de abajo acompaña ese ancho, también en el computador.

## Datos de esta versión

Quedan en el navegador de cada equipo. Sirve para usar la app en un computador. La base compartida, para cuando entren varios entrenadores, está en [propuesta-de-trabajo.docx](propuesta-de-trabajo.docx).
