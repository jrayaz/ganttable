# Electrical engineer level-up plan

Six months, about two hours a day. Reading theory alone fades within weeks, so every tool follows one loop: learn the theory, build a real exercise, solve a boss-fight calculation, then redo it from memory two weeks later in a spaced review. The boss fights and reviews feed the portfolio at the end. Every task starts after the tasks it follows, and the baseline column keeps the original schedule so slipped tasks show a red chip.

Tool notes: AutoCAD and Revit have education licences for students. MATLAB and Simulink are paid, so use a student licence or MATLAB Online, or practise in Octave, Scilab Xcos or OpenModelica. DIgSILENT PowerFactory has student and trial versions; pandapower and OpenDSS are free. Ignition has a free trial for SCADA. Check the current licence terms before you plan around them.

| WBS | Task | Start | End | Done | After | Area | Baseline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | E-rank: Fundamentals and 2D drawing | | | | | | |
| 1.1 | Theory: Ohm's law, KCL and KVL, Thevenin | 2026-10-12 | 2026-10-25 | 100% | | Theory | 2026-10-25 |
| 1.2 | LTspice: simulate a divider and an RC circuit | 2026-10-26 | 2026-11-01 | 100% | 1.1 | Simulation | 2026-10-30 |
| 1.3 | Boss fight: LED resistor and divider by hand, then verify | 2026-10-26 | 2026-11-03 | 100% | 1.1 | Calculation | 2026-11-01 |
| 1.4 | AutoCAD: install, 2D drawing basics, a lighting layout | 2026-10-12 | 2026-10-30 | 100% | | AutoCAD | 2026-10-30 |
| 1.5 | ◆ Rank up to D: hand calculation matches the simulation | 2026-11-08 | | | 1.2, 1.3, 1.4 | Habit | 2026-11-08 |
| 2 | D-rank: AC power and electrical drawings | | | | | | |
| 2.1 | Theory: phasors, impedance, power factor | 2026-11-02 | 2026-11-22 | 60% | 1.1 | Theory | 2026-11-19 |
| 2.2 | Simulink: RLC circuit and a single-phase source model | 2026-11-23 | 2026-11-29 | 0% | 2.1 | Simulation | 2026-11-29 |
| 2.3 | Boss fight: power factor correction for a 15 kW motor | 2026-11-30 | 2026-12-06 | 0% | 2.2 | Calculation | 2026-12-06 |
| 2.4 | AutoCAD: single-line diagram and cable schedule for a workshop | 2026-11-02 | 2026-11-22 | 20% | 1.4 | AutoCAD | 2026-11-19 |
| 2.5 | Spaced review: redraw the single-line diagram from memory | 2026-12-07 | 2026-12-13 | 0% | 2.4 | AutoCAD | 2026-12-13 |
| 2.6 | Spaced review: redo the power factor calculation without notes | 2026-12-14 | 2026-12-20 | 0% | 2.3 | Calculation | 2026-12-20 |
| 2.7 | ◆ Rank up to C: drawing and calculation both redone from memory | 2026-12-20 | | | 2.5, 2.6 | Habit | 2026-12-20 |
| 3 | C-rank: Power systems and the building model | | | | | | |
| 3.1 | Theory: three-phase, per-unit, faults and protection | 2026-12-21 | 2027-01-10 | 0% | 2.7 | Theory | 2027-01-10 |
| 3.2 | Revit: MEP basics and electrical families in a small building | 2026-12-21 | 2027-01-17 | 0% | 2.7 | Revit | 2027-01-17 |
| 3.3 | Boss fight: model the workshop in Revit, extract a panel schedule | 2027-01-18 | 2027-01-31 | 0% | 3.2 | Revit | 2027-01-31 |
| 3.4 | PowerFactory: load flow and short circuit of a small grid | 2027-01-11 | 2027-02-07 | 0% | 3.1 | PowerFactory | 2027-02-07 |
| 3.5 | Boss fight: short-circuit level and protection check | 2027-02-08 | 2027-02-14 | 0% | 3.4 | Calculation | 2027-02-14 |
| 3.6 | Spaced review: rebuild the Revit panel schedule from memory | 2027-02-01 | 2027-02-07 | 0% | 3.3 | Revit | 2027-02-07 |
| 3.7 | ◆ Rank up to B: workshop designed in CAD, BIM and a power study | 2027-02-14 | | | 3.5, 3.6 | Habit | 2027-02-14 |
| 4 | B-rank: Control, monitoring and the capstone | | | | | | |
| 4.1 | Theory: PLCs, Modbus and how a SCADA system is built | 2027-02-15 | 2027-02-21 | 0% | 3.7 | Theory | 2027-02-21 |
| 4.2 | SCADA: tags, alarms and trends on a simulated pump station | 2027-02-22 | 2027-03-07 | 0% | 4.1 | SCADA | 2027-03-07 |
| 4.3 | Simulink: closed-loop PID control of a motor | 2027-02-15 | 2027-02-28 | 0% | 3.7 | Simulation | 2027-02-28 |
| 4.4 | Boss fight: a SCADA screen showing live data from the Simulink model | 2027-03-08 | 2027-03-14 | 0% | 4.2, 4.3 | SCADA | 2027-03-14 |
| 4.5 | ◆ Rank up to A: every tool used on one working system | 2027-03-14 | | | 4.4 | Habit | 2027-03-14 |
| 5 | A-rank: Portfolio | | | | | | |
| 5.1 | GitHub repo with worked examples in the README | 2027-03-15 | 2027-03-21 | 0% | 4.5 | Portfolio | 2027-03-21 |
| 5.2 | Case study: the workshop from calculation to drawing to model | 2027-03-15 | 2027-03-24 | 0% | 4.5 | Portfolio | 2027-03-24 |
| 5.3 | Portfolio site live | 2027-03-25 | 2027-03-28 | 0% | 5.2 | Portfolio | 2027-03-28 |
| 5.4 | Resume and LinkedIn refresh | 2027-03-15 | 2027-03-24 | 0% | | Portfolio | 2027-03-24 |
| 5.5 | ◆ S-rank: first 10 applications sent | 2027-03-28 | | | 5.3, 5.4 | Habit | 2027-03-28 |
| 6 | Daily quests | | | | | | |
| 6.1 | Daily quest: 2 hours of study and one worked exercise | 2026-10-12 | 2027-03-28 | 12% | | Habit | 2027-03-28 |
| 6.2 | Weekly review and error log | 2026-10-12 | 2027-03-28 | 14% | | Habit | 2027-03-28 |

```gantt
title: Electrical engineer level-up plan
```
