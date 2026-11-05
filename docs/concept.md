# The level-up plan: a way to learn tools that sticks

Reading theory alone fades within weeks. A plan that survives has four parts for every skill:

1. **Learn:** a short block of theory.
2. **Build:** an exercise in the real tool, not a tutorial you watch.
3. **Boss fight:** one realistic calculation or project that uses the skill. It goes into your portfolio.
4. **Spaced review:** about two weeks later, redo the exercise from memory. If you cannot, the skill was not learned yet, and you have found out early.

Ranks (E, D, C, B, A, S) group these loops. A rank ends with a **rank-up checkpoint**, a milestone that is only passed when the boss fight and the review are done. Alongside the ranks, a **daily quest** (study time plus one worked exercise) and a **weekly review with an error log** keep the habit going.

## Why a Gantt chart

A study plan is a schedule with dependencies: you cannot do the boss fight before the theory, or the review before the build. A Gantt chart makes the order visible, and a **baseline** column shows how far each task has slipped from the original plan. That is usually the first sign you are behind, long before you feel it.

## How the example uses Ganttable

The full example is in [example-level-up-plan.md](example-level-up-plan.md): six months from circuit fundamentals to a portfolio, covering AutoCAD, Revit, LTspice and Simulink, PowerFactory and SCADA.

- **WBS numbers** (`1`, `1.1`, `1.2`) group tasks into ranks, and each rank rolls up to one summary bar.
- **Area** is the lane for each tool: Theory, Simulation, AutoCAD, Revit, PowerFactory, SCADA, Calculation, Portfolio and Habit. Choose **Group: Owner** in the toolbar to see one lane per tool, and spot the tool you are neglecting.
- **After** links each task to the one it follows. If you start something before its prerequisite ends, the link turns red and a conflict is counted.
- **Done** is your progress. Drag the small grip inside a bar to update it in one gesture.
- **Baseline** keeps the original finish date, so slipped tasks show a red `+3d` chip.
- **Milestones** are rows that start with `◆`, `<>`, `(ms)` or `[ms]`. They are the rank-ups.

Copy the file into a note, press **Open gantt**, and replace the tasks with your own. Keep the loop: learn, build, boss fight, review.

## Tool notes

Check each tool's current licence before you plan around it.

- AutoCAD and Revit have education licences for students.
- MATLAB and Simulink are paid. Use a student licence or MATLAB Online, or practise in Octave, Scilab Xcos or OpenModelica.
- DIgSILENT PowerFactory has student and trial versions. pandapower and OpenDSS are free alternatives.
- Ignition has a free trial for SCADA practice.
