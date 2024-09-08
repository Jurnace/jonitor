use std::ffi::c_void;

use byteorder::ByteOrder;
use windows_sys::{
    w,
    Win32::{
        Foundation::{CloseHandle, FALSE, HANDLE},
        System::Memory::{
            MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ,
            MEMORY_MAPPED_VIEW_ADDRESS,
        },
    },
};

pub(crate) struct SharedMemory {
    // handle of the file mapping object
    handle: HANDLE,
    // starting address of the mapped view
    pointer: *mut c_void,
    // last poll time from HWiNFO
    last_poll_time: i64,
    sensor_ids: Vec<SensorId>,
    sensor_names: Vec<[u8; 128]>,
    // starting offset of readings of each sensor
    // e.g. reading ids of sensor i = reading_ids[reading_offsets[i]..reading_offsets[i+1]]
    reading_offsets: Vec<usize>,
    reading_ids: Vec<u32>,
    reading_names: Vec<[u8; 128]>,
    reading_units: Vec<[u8; 16]>,
    // current value and highest value of all readings in sequence
    reading_values: Vec<f64>,
    // incremented when sensor information is updated
    sensor_info_updated_count: u64,
}

impl SharedMemory {
    pub(crate) fn init() -> Result<SharedMemory, ReadError> {
        let name = w!("Global\\HWiNFO_SENS_SM2");

        let handle = unsafe { OpenFileMappingW(FILE_MAP_READ, FALSE, name) };

        if handle.is_null() {
            return Err(ReadError::Os(format!(
                "failed to open a named file mapping object (error {}). Make sure HWiNFO is running in Sensors-only mode, and Shared Memory Support is enabled.",
                get_os_error()
            )));
        }

        let pointer = unsafe { MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0).Value };

        if pointer.is_null() {
            return Err(ReadError::Os(format!(
                "failed to map a view of file mapping (error {})",
                get_os_error()
            )));
        }

        let data = unsafe { &mut *(pointer as *mut HwinfoData) };

        Ok(SharedMemory {
            handle,
            pointer,
            last_poll_time: 0,
            sensor_ids: Vec::with_capacity(data.sensor_count as usize),
            sensor_names: Vec::with_capacity(data.sensor_count as usize),
            reading_offsets: Vec::with_capacity(data.sensor_count as usize),
            reading_ids: Vec::with_capacity(data.reading_count as usize),
            reading_names: Vec::with_capacity(data.reading_count as usize),
            reading_units: Vec::with_capacity(data.reading_count as usize),
            reading_values: Vec::with_capacity(2 + data.reading_count as usize * 2),
            sensor_info_updated_count: 0,
        })
    }

    /// Reads data from HWiNFO
    ///
    /// # Return
    /// On success, a vector of `u8` and a JSON encoded HWiNFO sensor information are returned.
    /// The vector contains binary data ready to be sent over WebSocket, or it is empty if data
    /// from HWiNFO has not changed since `read()` was last called.
    ///
    /// The content of the vector begins with an `i64` integer (last_poll_time) and an `u64` integer
    /// (sensor_info_updated_count), and 2 `f64` numbers on repeat, representing current reading
    /// value and highest reading value.
    ///
    /// The option contains JSON encoded HWiNFO sensor information, or it is `None` if the sensor
    /// information has not changed since `read()` was last called.
    ///
    /// # Example content of the returned tuple
    /// ```
    /// Vec<u8>[
    ///     d2, 02, 96, 49, 00, 00, 00, 00, // offset 0, last_poll_time (i64)
    ///     01, 00, 00, 00, 00, 00, 00, 00, // offset 1, sensor_info_updated_count (u64)
    ///     ae, 47, e1, 7a, 14, ae, f3, 3f, // offset 2, Sensor 1, Reading 1, current value (f64)
    ///     3d, 0a, d7, a3, 70, 3d, 12, 40, // offset 3, Sensor 1, Reading 1, maximum value (f64)
    ///     8f, c2, f5, 28, 5c, 8f, 1f, 40, // offset 4, Sensor 1, Reading 2, current value (f64)
    ///     ae, 47, e1, 7a, 14, ae, 09, 40, // offset 5, Sensor 1, Reading 2, maximum value (f64)
    ///     29, 5c, 8f, c2, f5, 28, 1a, 40, // offset 6, Sensor 2, Reading 3, current value (f64)
    ///     3d, 0a, d7, a3, 70, bd, 23, 40, // offset 7, Sensor 2, Reading 3, maximum value (f64)
    /// ],
    /// Some(r##"{
    ///     "updatedCount": 1,
    ///     "sensors": [
    ///         {
    ///             "id": 123,
    ///             "instance": 0,
    ///             "name": "Sensor 1",
    ///             "readings": [
    ///                 {
    ///                     "id": 4560,
    ///                     "name": "Reading 1",
    ///                     "unit": "%"
    ///                 },
    ///                 {
    ///                     "id": 4561,
    ///                     "name": "Reading 2",
    ///                     "unit": "V"
    ///                 }
    ///             ],
    ///             "offset": 2
    ///         },
    ///         {
    ///             "id": 124,
    ///             "instance": 0,
    ///             "name": "Sensor 2",
    ///             "readings": [
    ///                 {
    ///                     "id": 7890,
    ///                     "name": "Reading 3",
    ///                     "unit": "A"
    ///                 }
    ///             ],
    ///             "offset": 6
    ///         }
    ///     ]
    /// }"##)
    /// ```
    pub(crate) fn read(&mut self) -> Result<(Vec<u8>, Option<String>), ReadError> {
        let data = unsafe { &mut *(self.pointer as *mut HwinfoData) };

        if data.signature == 1145389380 {
            return Err(ReadError::HwinfoClosed);
        }

        if data.poll_time <= self.last_poll_time {
            return Ok((Vec::with_capacity(0), None));
        }

        self.last_poll_time = data.poll_time;
        self.reading_offsets.clear();
        self.reading_values.clear();

        // will be replaced with real values
        self.reading_values.push(0.0); // last_poll_time
        self.reading_values.push(0.0); // sensor_info_updated_count

        let sensor_count = data.sensor_count as usize;
        let reading_count = data.reading_count as usize;

        let mut sensor_info_updated = false;
        let mut last_hwinfo_sensor_index = 0;
        let mut sensor_id_index = 0;

        if sensor_count != self.sensor_names.len() || reading_count != self.reading_names.len() {
            sensor_info_updated = true;

            // resizing instead of clearing so old values can be accessed for comparing
            self.sensor_ids
                .resize(sensor_count, SensorId { id: 0, instance: 0 });
            self.sensor_names.resize(sensor_count, [0; 128]);
            self.reading_ids.resize(reading_count, 0);
            self.reading_names.resize(reading_count, [0; 128]);
            self.reading_units.resize(reading_count, [0; 16]);
        }

        for i in 0..reading_count {
            let reading_ptr = unsafe {
                self.pointer
                    .add((data.reading_offset + (data.reading_size * i as u32)) as usize)
            };

            let reading = unsafe { &mut *(reading_ptr as *mut HwinfoReading) };

            let sensor_ptr = unsafe {
                self.pointer
                    .add((data.sensor_offset + (data.sensor_size * reading.sensor_index)) as usize)
            };

            let sensor = unsafe { &mut *(sensor_ptr as *mut HwinfoSensor) };

            if i == 0 {
                last_hwinfo_sensor_index = reading.sensor_index;
                self.reading_offsets.push(0);
            }

            if last_hwinfo_sensor_index != reading.sensor_index {
                // now accessing readings from a different sensor
                last_hwinfo_sensor_index = reading.sensor_index;
                sensor_id_index += 1;

                self.reading_offsets.push(i);
            }

            let sensor_id = self.sensor_ids.get_mut(sensor_id_index).unwrap();
            let reading_id = self.reading_ids.get_mut(i).unwrap();

            if sensor_id.id != sensor.id || sensor_id.instance != sensor.instance {
                sensor_info_updated = true;

                sensor_id.id = sensor.id;
                sensor_id.instance = sensor.instance;

                sensor
                    .display_name
                    .clone_into(self.sensor_names.get_mut(sensor_id_index).unwrap());

                // update reading here as different readings can have the same reading id
                *reading_id = reading.id;
                reading
                    .display_label
                    .clone_into(self.reading_names.get_mut(i).unwrap());
                reading
                    .unit
                    .clone_into(self.reading_units.get_mut(i).unwrap());
            } else if *reading_id != reading.id {
                sensor_info_updated = true;

                *reading_id = reading.id;
                reading
                    .display_label
                    .clone_into(self.reading_names.get_mut(i).unwrap());
                reading
                    .unit
                    .clone_into(self.reading_units.get_mut(i).unwrap());
            }

            self.reading_values.push(reading.value);
            self.reading_values.push(reading.value_max);
        }

        let sensor_info_json;

        if sensor_info_updated {
            let mut sensors = Vec::with_capacity(self.reading_offsets.len());
            for i in 0..self.reading_offsets.len() {
                let sensor_id = self.sensor_ids.get(i).unwrap();

                let sensor_name = self.sensor_names.get(i).unwrap();
                let sensor_name = match std::str::from_utf8(trim_str(sensor_name)) {
                    Ok(s) => s.to_owned(),
                    Err(_) => {
                        return Err(ReadError::Other(format!(
                            "the sensor name is not a valid UTF-8 string {:?}",
                            sensor_name
                        )));
                    }
                };

                // get the starting and ending indices of reading ids, names and units for the sensor
                let start = *self.reading_offsets.get(i).unwrap();
                let end = if i == self.reading_offsets.len() - 1 {
                    self.reading_names.len()
                } else {
                    *self.reading_offsets.get(i + 1).unwrap()
                };

                let mut readings = Vec::with_capacity(end - start);

                for j in start..end {
                    let reading_name = self.reading_names.get(j).unwrap();
                    let reading_name = match std::str::from_utf8(trim_str(reading_name)) {
                        Ok(s) => s.to_owned(),
                        Err(_) => {
                            return Err(ReadError::Other(format!(
                                "the reading name is not a valid UTF-8 string {:?}",
                                reading_name
                            )));
                        }
                    };

                    let unit = self.reading_units.get(j).unwrap();
                    let unit = match std::str::from_utf8(trim_str(unit)) {
                        Ok(s) => s.to_owned(),
                        Err(_) => {
                            return Err(ReadError::Other(format!(
                                "the reading unit is not a valid UTF-8 string {:?}",
                                unit
                            )));
                        }
                    };

                    readings.push(ReadingData {
                        id: self.reading_ids[j],
                        name: reading_name,
                        unit,
                    });
                }

                sensors.push(SensorData {
                    id: sensor_id.id,
                    instance: sensor_id.instance,
                    name: sensor_name,
                    readings,
                    offset: (2 + start * 2) as u32,
                });
            }

            self.sensor_info_updated_count += 1;

            let sensor_info = SensorInfo {
                updated_count: self.sensor_info_updated_count,
                sensors,
            };

            match serde_json::to_string(&sensor_info) {
                Ok(json) => sensor_info_json = Some(json),
                Err(_) => {
                    return Err(ReadError::Other(String::from(
                        "failed to convert to json string",
                    )))
                }
            }
        } else {
            sensor_info_json = None;
        }

        let values = &mut self.reading_values[..];
        byteorder::LittleEndian::from_slice_f64(values);

        // cast [f64] to [u8] to be used as a websocket binary message
        let bytes = unsafe {
            std::slice::from_raw_parts_mut(
                values.as_mut_ptr() as *mut u8,
                std::mem::size_of_val(values),
            )
        };

        let mut output: Vec<u8> = bytes.to_vec();
        // copy an i64 into the first 8 bytes
        output[0..8].copy_from_slice(&self.last_poll_time.to_le_bytes());
        // copy an u64 into the next 8 bytes
        output[8..16].copy_from_slice(&self.sensor_info_updated_count.to_le_bytes());

        Ok((output, sensor_info_json))
    }
}

impl Drop for SharedMemory {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS {
                Value: self.pointer,
            });
            CloseHandle(self.handle);
        }
    }
}

unsafe impl Send for SharedMemory {}

fn get_os_error() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap()
}

/// Returns a slice with the first null byte and everything after the first null byte removed.
fn trim_str(str: &[u8]) -> &[u8] {
    if let Some(i) = str.iter().position(|b| *b == 0) {
        return &str[0..i];
    }

    str
}

#[derive(Clone)]
struct SensorId {
    id: u32,
    instance: u32,
}

#[repr(C, packed)]
struct HwinfoData {
    signature: u32,
    version: u32,
    revision: u32,
    poll_time: i64,

    sensor_offset: u32,
    sensor_size: u32,
    sensor_count: u32,

    reading_offset: u32,
    reading_size: u32,
    reading_count: u32,

    polling_period: u32,
}

#[repr(C, packed)]
struct HwinfoSensor {
    id: u32,
    instance: u32,
    original_name_ansi: [i8; 128],
    display_name_ansi: [i8; 128],
    display_name: [u8; 128],
}

#[repr(C, packed)]
struct HwinfoReading {
    reading_type: i32,
    sensor_index: u32,
    id: u32,
    original_label_ansi: [i8; 128],
    display_label_ansi: [i8; 128],
    unit_ansi: [i8; 16],
    value: f64,
    value_min: f64,
    value_max: f64,
    value_avg: f64,
    display_label: [u8; 128],
    unit: [u8; 16],
}

#[derive(Debug)]
pub(crate) enum ReadError {
    Os(String),
    Other(String),
    HwinfoClosed,
}

#[derive(serde::Serialize)]
struct SensorInfo {
    #[serde(rename = "updatedCount")]
    updated_count: u64,
    sensors: Vec<SensorData>,
}

#[derive(serde::Serialize)]
struct SensorData {
    id: u32,
    instance: u32,
    name: String,
    readings: Vec<ReadingData>,
    offset: u32,
}

#[derive(serde::Serialize)]
struct ReadingData {
    id: u32,
    name: String,
    unit: String,
}
