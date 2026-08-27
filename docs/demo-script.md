# VOLT-TERRA Demo Narration

EV registrations are outrunning public charging in specific counties. But knowing a county is short on chargers doesn't tell you what to do about it. Sometimes you just need another charger. Sometimes the local grid can't carry one yet, and that's a different budget on a different timeline. Nobody has a fast way to tell those apart before the money is committed.

So we built VOLT-TERRA. It ranks every county by how far its charging has fallen behind, then works out which of those two problems each one actually has.

This ran unattended across all 58 California counties. It pulled DOE charger locations and three years of DMV registrations, joined them against live Mireye grid data, and flagged six counties. Each carries more than twice the state median of EVs per public port. That threshold is peer relative, so it moves with the data instead of being a number we picked.

For each county it samples at the census population center and runs three physical gates on live Mireye data. Is there a substation. Is it within five miles. Is it above 60 kilovolts. Pass all three and the county is fund a charger now. Fail one and it's fund a grid upgrade first. Missing evidence gets its own bucket instead of a guess.

Every number is traceable, with a source, a fetch time and a confidence rating, and the memo underneath is built from those same values, ready to attach to a funding request. It isn't limited to counties either. Click any coordinate and it runs the same three gates on the spot.

That's the agentic part, and none of it is a fixed script. It decides which counties clear the threshold, it decides each bucket from live physical evidence, and it decides when what it already has isn't good enough to answer with. It has tools that spend real money, it knows what each one costs, and it weighs whether an answer is worth paying for. When the evidence is thin or two sources disagree, it goes and buys more, then revises its own conclusion and tells you what changed.

We checked the flagged counties against real federal NEVI awards, and five of six had already received funding independently. So it ranks, it decides, it shows its sources, and when the evidence under a decision looks thin, it goes and gets more.
