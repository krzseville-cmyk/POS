package com.simplepos.app

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

/**
 * Sends raw ESC/POS bytes (built by the web app) to a paired Bluetooth thermal printer
 * over the Serial Port Profile, which nearly all 58 mm / 80 mm receipt printers use.
 * Callers must hold the Bluetooth permission and call [print] off the main thread.
 */
class BluetoothPrinter(context: Context) {

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** Paired devices as {"printers":[{name,address}]} or {"error": "..."}. */
    @SuppressLint("MissingPermission")
    fun pairedDevices(): JSONObject {
        val result = JSONObject()
        when {
            adapter == null -> result.put("error", "This phone has no Bluetooth")
            !adapter.isEnabled -> result.put("error", "Turn on Bluetooth, then try again")
            else -> {
                val list = JSONArray()
                adapter.bondedDevices.orEmpty()
                    .sortedBy { it.name ?: it.address }
                    .forEach { list.put(JSONObject().put("name", it.name ?: it.address).put("address", it.address)) }
                result.put("printers", list)
            }
        }
        return result
    }

    /** Returns null on success, or a message to show the user. */
    @SuppressLint("MissingPermission")
    fun print(address: String, bytes: ByteArray): String? {
        val bt = adapter ?: return "This phone has no Bluetooth"
        if (!bt.isEnabled) return "Bluetooth is off"
        val device = try {
            bt.getRemoteDevice(address)
        } catch (e: IllegalArgumentException) {
            return "That printer address isn't valid"
        }
        // Some printers only accept the insecure connection, so try both.
        val connectors = listOf<() -> BluetoothSocket>(
            { device.createRfcommSocketToServiceRecord(SPP_UUID) },
            { device.createInsecureRfcommSocketToServiceRecord(SPP_UUID) },
        )
        for (connect in connectors) {
            try {
                connect().use { socket ->
                    socket.connect()
                    socket.outputStream.write(bytes)
                    socket.outputStream.flush()
                    // Give the printer time to take everything before the link closes.
                    Thread.sleep(500)
                }
                return null
            } catch (_: IOException) {
            } catch (_: SecurityException) {
                return "Bluetooth permission is needed to print"
            }
        }
        return "Couldn't reach the printer. Check that it's on, paired and not connected to another phone."
    }

    companion object {
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
