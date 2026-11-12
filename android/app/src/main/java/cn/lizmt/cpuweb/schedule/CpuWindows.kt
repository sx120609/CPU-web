package cn.lizmt.cpuweb.schedule

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

// Sheets, dialogs and menus open in windows of their own, and each window starts
// again from the system's display and text size. These are the Material ones with
// their content put back on the app's own scale (NativeScale), so a sheet matches
// the page it opened from. Use them instead of ModalBottomSheet, AlertDialog and
// DropdownMenu; `android/tests/native-scale.test.mjs` checks that nothing else does.

/** A Material bottom sheet whose handle and content use the app's scale. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CpuBottomSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    sheetState: SheetState = rememberModalBottomSheetState(),
    dragHandle: @Composable (() -> Unit)? = { BottomSheetDefaults.DragHandle() },
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        sheetState = sheetState,
        dragHandle = dragHandle?.let { handle -> { NativeScale(handle) } },
    ) {
        NativeScale { Column(Modifier.fillMaxWidth(), content = content) }
    }
}

/** A Material alert dialog whose title, text and buttons use the app's scale. */
@Composable
fun CpuAlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: @Composable (() -> Unit)? = null,
    title: @Composable (() -> Unit)? = null,
    text: @Composable (() -> Unit)? = null,
    shape: Shape = AlertDialogDefaults.shape,
) {
    AlertDialog(
        onDismissRequest = onDismissRequest,
        confirmButton = { NativeScale(confirmButton) },
        modifier = modifier,
        dismissButton = dismissButton?.let { button -> { NativeScale(button) } },
        title = title?.let { slot -> { NativeScale(slot) } },
        text = text?.let { slot -> { NativeScale(slot) } },
        shape = shape,
    )
}

/** A Material dropdown menu whose items use the app's scale. */
@Composable
fun CpuDropdownMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest, modifier = modifier) {
        NativeScale { Column(content = content) }
    }
}

/** A dialog window whose content uses the app's scale. */
@Composable
fun CpuDialog(onDismissRequest: () -> Unit, properties: DialogProperties = DialogProperties(), content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismissRequest, properties = properties) { NativeScale(content) }
}
