import Foundation

// Run with ios_next/scripts/check-dorm-schedule.sh. The expected values are
// Android's (`ScheduleParityTest`) and the Web's (`web/tests/nativeDormSync.test.ts`).

@main
struct NativeDormChecks {
    static func main() {
        // An in-app invite link keeps its code on the dorm page.
        precondition(DormRules.pagePath("/schedule?dorm=1&code=%20abc234") == "/dorm-schedule?code=ABC234")
        precondition(DormRules.pagePath("/schedule?code=ABC234&dorm=1#top") == "/dorm-schedule?code=ABC234")
        // A code that cannot be one is dropped; the page still opens.
        precondition(DormRules.pagePath("/schedule?dorm=1&code=%3Cscript%3E") == "/dorm-schedule")
        precondition(DormRules.pagePath("/schedule?dorm=1") == "/dorm-schedule")
        // Everything else stays with the native timetable.
        precondition(DormRules.pagePath("/schedule") == nil)
        precondition(DormRules.pagePath("/schedule?couple=1&code=ABC234") == nil)
        precondition(DormRules.pagePath("/schedule?dorm=0") == nil)
        precondition(DormRules.pagePath("/schedule/share/ABCD2345?dorm=1") == nil)
        precondition(DormRules.pagePath("/dorm-schedule?code=ABC234") == nil)
        precondition(DormRules.page(code: " k7m2qx ") == "/dorm-schedule?code=K7M2QX")

        // Only the term running now goes to the page.
        let terms: [(value: String, current: Bool)] = [("2025-2026-2", false), ("2026-2027-1", true)]
        precondition(DormRules.isCurrentTerm("2026-2027-1", terms: terms))
        precondition(!DormRules.isCurrentTerm("2025-2026-2", terms: terms))
        precondition(DormRules.isCurrentTerm("2026-2027-1", terms: []), "no list of terms: the one on screen")
        precondition(!DormRules.isCurrentTerm("", terms: terms))

        let offer = DormRules.offer(body: ["semester": "2026-2027-1"], account: "acct-a")
        precondition(offer["action"] as? String == "offer")
        precondition(offer["account"] as? String == "acct-a")
        precondition((offer["snapshot"] as? [String: Any])?["semester"] as? String == "2026-2027-1")
        precondition(DormRules.offer(body: [:], account: "")["account"] == nil)
        print("dorm checks passed")
    }
}
