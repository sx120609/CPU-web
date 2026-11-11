import Foundation

extension ScheduleOverlayTiming {
    /// `block`, read with `theirs` bells, moved onto `mine`. The course keeps
    /// its real clock times so its card, quick look and 「TA 此刻」 read them.
    static func remap(_ block: NativeScheduleCourseBlock, theirs: [Period], mine: [Period]) -> NativeScheduleCourseBlock {
        guard !sameBells(theirs, mine) else { return block }
        let course = block.course
        let start = course.customStartTime.flatMap(minutes)
            ?? theirs.first { $0.number == block.courseStartSlot }?.start
        let end = course.customEndTime.flatMap(minutes)
            ?? theirs.first { $0.number == block.courseEndSlot }?.end
        guard let start, let end, end > start, let placed = place(start: start, end: end, on: mine) else { return block }
        var moved = NativeScheduleCourseBlock(
            id: block.id, course: course.withClock(start: clock(start), end: clock(end)),
            bigSlot: (placed.start + 1) / 2, startSlot: placed.start, endSlot: placed.end, lane: block.lane
        )
        moved.owner = block.owner
        moved.together = block.together
        return moved
    }
}
