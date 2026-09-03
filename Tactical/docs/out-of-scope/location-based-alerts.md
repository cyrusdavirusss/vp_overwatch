# Out of Scope: Location-Based Alerts

## Overview

Location-based proximity alerts and geofencing capabilities are documented as **out of scope** for the current ADS-B Exchange Dashboard release (v1.0).

## Rationale

### Current Release Focus
The v1.0 release prioritizes:
- **Core data ingestion**: Reliable ADS-B Exchange provider integration
- **State management**: Accurate aircraft state classification (unresolved, live_airborne, live_ground, stale, unavailable)
- **Cache-backed serving**: Efficient dashboard data delivery without triggering provider calls
- **Session-based authentication**: Secure access control
- **Data normalization**: Proper null handling and unit conversions (feet to metres)

### Complexity Considerations

Location-based alerts introduce additional complexity:
1. **Geofence management UI**: Requires map-based interface for defining alert zones
2. **Real-time proximity calculations**: Continuous distance computations against multiple geofences
3. **Alert delivery mechanisms**: Push notifications, email, or in-app alerts
4. **Persistence layer**: Storing geofence configurations and alert histories
5. **Event deduplication**: Preventing alert storms from repeated proximity events

### Future Release Pathway

Location-based alerts are planned for **v1.1** or **v2.0** depending on:
- Operational feedback from v1.0 deployment
- Identified use cases from VicPol Overwatch operations
- Available development capacity

## Current State Event Support

The dashboard v1.0 includes state change event detection:
- **Takeoff events**: Ground → Airborne transitions
- **Landing events**: Airborne → Ground transitions
- **Telemetry not seen**: Live → Unavailable transitions
- **Reappeared events**: Unavailable → Live transitions
- **Proximity enter**: (Foundation for future location-based alerts)

These events are captured in the `AircraftEvent` interface and can be extended to support location-based triggers in future releases.

## Technical Foundation

The current implementation provides the foundation for location-based alerts:
- `DashboardStateManager.detectStateChangeEvent()` - Event detection framework
- `AircraftEvent` interface with `dedupKey` - Deduplication support
- `isPositionUsable` flag - Position validity checks
- `latitude`/`longitude` tracking - Geospatial data availability

## References

- Implementation: `lib/adsb/dashboard-state-manager.ts`
- Event Interface: `AircraftEvent` type definition
- State Values: `AircraftState` union type