---
name: musk-playbook
description: Apply Elon Musk's engineering and operating playbook — first-principles cost reasoning, "the algorithm" (question / delete / simplify / accelerate / automate), owning the bottleneck, and iterating on the real artifact — plus the documented failure modes that come with it. Use this skill whenever someone is deciding whether to build or buy, attacking a cost or latency number that "just is what it is", cutting scope, killing complexity, questioning a requirement or spec, planning a rewrite or a migration, wondering why a system got so expensive or so slow, or asking how to move faster on hardware, infrastructure, or product. Also use it when the user explicitly asks for first-principles thinking, "the Musk algorithm", radical simplification, a de-scoping pass, or an aggressive-timeline plan — and when they ask what Musk's skills or methods actually are.
---

# The Musk Playbook

A decision procedure distilled from how Musk's companies actually reach hard numbers — cost per kilogram to orbit, cost per kWh of battery, minutes per car. It is not hero worship, and it is not a personality to imitate. It is a specific, transferable way of attacking a number everyone else treats as fixed, paired with the specific ways that approach fails.

Use it when a constraint is being *accepted* rather than *derived*. If nobody can tell you where a number comes from, that number is usually wrong.

## The core move: derive the floor

Most cost, latency, and schedule numbers are inherited — they are what the market charges, what the vendor quotes, what the last team measured. First-principles reasoning replaces the inherited number with a derived one:

1. **Find the physical or irreducible floor.** For hardware: what do the raw materials cost on the open market? For software: how many bytes must actually move, how many round trips are unavoidable, what is the algorithmic lower bound? For a schedule: what is the longest chain of steps that genuinely cannot be parallelized?
2. **Compute the multiple.** Current number ÷ floor. This is the only number that matters at the start.
3. **Attribute the gap.** Every factor of 2 between floor and reality has an owner: a middleman's margin, a batch size, a serialization point, a requirement nobody has revisited. Name them.
4. **Attack the biggest term first,** not the easiest.

The canonical example: battery packs were quoted at roughly $600/kWh because that was the market price. Pricing the constituent metals on the London Metal Exchange put the materials near $80/kWh. The ~7× gap was the actual problem statement — and it pointed at supply chain and pack design, not at negotiating harder.

Do this before proposing solutions. A derived floor turns "make it cheaper" into a specific target with a specific list of suspects.

## The algorithm

Musk's five-step process, in strict order. The ordering *is* the insight — most engineering waste is steps 3–5 applied to something that should have failed step 1 or 2.

**1. Question every requirement.** Each requirement must come with the name of a person, never a department. "Legal requires it" is not an answer; "Sam in legal, in March, for reason X" is. Then ask that person whether the reason still holds. Requirements from smart, senior people are the most dangerous, because nobody challenges them.

**2. Delete the part, process, or step.** If you aren't later forced to add back at least ~10% of what you deleted, you didn't delete aggressively enough. A deletion rate that never overshoots means you're only removing things that were already obviously dead.

**3. Simplify and optimize** — but only what survived step 2. The most common failure mode of good engineers is beautifully optimizing something that should not exist. This is where the ordering earns its keep.

**4. Accelerate cycle time.** Speed up every remaining step. Not before steps 1–3, or you'll be sprinting on a path that leads nowhere.

**5. Automate.** Last. Automating a process before questioning, deleting, and simplifying it locks the waste into a machine, where it becomes far more expensive to remove. Tesla's over-automated 2018 assembly line is the standing example: robots were installed, then ripped back out, because the process hadn't been simplified first.

When applying this, say which step you are on. Skipping ahead is the most common way it degrades into ordinary refactoring.

## Structural bets

**Own the bottleneck.** Whatever step dominates your cost or schedule should be inside your control, even if buying it looks cheaper per unit. SpaceX brought engines, avionics, and machining in-house; Tesla brought cells, casting, and firmware in. The reasoning is not "vendors are bad" — it is that you cannot iterate faster than the slowest thing you don't control. Conversely: **do not** vertically integrate anything that isn't a bottleneck. That's just expensive vanity.

**The factory is the product.** A working prototype proves very little; the hard, valuable problem is the machine that builds the machine. In software, the equivalent is the build, test, and deploy loop — invest there before optimizing any individual feature, because it multiplies everything downstream.

**Iterate on the real artifact.** Test the actual thing, early and often, and accept a high failure rate to buy iteration speed. Starship's blow-up-early cadence produces more information per month than a longer analysis-heavy program. This trade is only valid when failures are *cheap and instrumented* — see the failure modes below.

**Stay technical enough that nobody can bluff you.** Whoever is making the call must be able to interrogate the details directly rather than relying on a summary. A manager who can only read status reports cannot tell a real constraint from a defended one, which breaks step 1 of the algorithm entirely.

**Root-cause, don't patch.** When something breaks, chase it to the actual cause instead of fixing the symptom. Patches accumulate into exactly the requirement-thicket that step 1 exists to clear.

## Failure modes

This playbook has a well-documented downside, and applying it without the counterweights produces the bad version. Raise these explicitly when you use the playbook — the honest version of this advice includes them.

| Failure mode | What it looks like | Counter-check |
|---|---|---|
| **Systematic schedule optimism** | Timelines missed by years, not weeks — Full Self-Driving, Cybertruck, crewed Mars. | Give the aggressive target *and* a calibrated estimate from historical throughput. Never let the stretch goal be the only number a decision depends on. |
| **Deleting load-bearing things** | The ~10% add-back rule is a license to cut too far. Cut something safety-, compliance-, or data-integrity-critical and the add-back may come after the incident. | Before deleting, ask what failure this part prevents and whether that failure is reversible. Irreversible failures are outside the delete-and-add-back loop. |
| **Speed that isn't buying information** | Rapid iteration only beats analysis when each failure is cheap and instrumented. Fast cycles on expensive, unmeasured failures is just churn. | Confirm before each cycle: what will this run tell us that we don't know, and can we afford to lose it? |
| **Optimizing the wrong level** | First-principles reasoning is seductive enough to justify rebuilding things that were fine. Not every inherited number is wrong. | Compute the multiple *first*. Under ~2×, the gap probably isn't worth attacking. |
| **Burning the people** | High executive turnover, abrupt mass layoffs, treating staff as fungible against the mission. This is a real cost, not a rounding error, and it compounds. | Aggressive on scope and schedule; not on people. The playbook's engineering content does not require the human cost — those are separable. |
| **Attention spread thin** | Running many things at once means each gets a fraction of the decision-maker. | Bottleneck-ownership means picking few enough bottlenecks to actually own. |
| **Public volatility** | The 2018 "funding secured" tweet cost an SEC settlement and a chairmanship. Speed norms applied to public communication create legal and commercial damage. | Iterate fast on artifacts; not on statements that bind you. |

## Applying it in a working session

Given a target — a slow endpoint, an expensive pipeline, a bloated service, a schedule that won't fit — work in this order and show your reasoning at each stage:

1. **State the number and its floor.** "This costs X. The irreducible floor is Y. The multiple is X/Y."
2. **Enumerate requirements with owners.** List what forces the current design, with a name and a date next to each. Flag the ones nobody can source — those are the first candidates.
3. **Propose deletions before improvements.** Say what you'd remove, and what you predict will need to come back. If your list is only obviously-dead code, you haven't gone far enough.
4. **Only then simplify what remains.**
5. **Then attack cycle time**, then automate.
6. **Name the bottleneck** and say whether it's owned or outsourced.
7. **Close with the counter-checks:** the calibrated schedule alongside the aggressive one, and anything on the deletion list whose failure mode is irreversible.

The output should be a short, ordered plan where every step is traceable to a derived number — not a list of best practices.

## When not to use this

Reach for something else when the constraint genuinely is fixed and well-understood (regulated processes, cryptographic parameters, published protocol specs), when failures are irreversible or unbounded (safety-critical, financial settlement, data destruction), or when the work is routine maintenance where the existing design is already near its floor. The playbook's value comes from a large derived multiple; with no multiple, it's just an expensive way to churn a working system.
