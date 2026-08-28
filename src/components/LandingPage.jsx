export default function LandingPage({ onSelectRole }) {
  return (
    <div className="landing">
      <div className="landing-card landing-role-selection">
        <div className="landing-eyebrow">VOLT-TERRA GEOSPATIAL PLATFORM</div>
        <h1 className="landing-title">Select Your Primary Access Role</h1>
        <p className="landing-lede">
          Please identify your use case to launch the specialized intelligence suite.
        </p>

        <div className="landing-role-grid">
          {/* Role Option 1: EV Facility */}
          <div className="role-card facility-role card">
            <div className="role-badge green">FACILITY PLANNER</div>
            <h2>EV Facility</h2>
            <p className="role-desc">
              For municipal planners and grid operators. Evaluates county-level EV demand vs public charging gaps, checks 3-gate grid interconnect feasibility using Mireye API evidence, and categorizes counties into Grid Upgrade Required vs Immediate Charger Needed.
            </p>
            <div className="role-features">
              <span>Mireye 3-gate grid interconnect</span>
              <span>Substation voltage & distance</span>
              <span>50 US States live sweep</span>
              <span>Cited justification memos</span>
            </div>
            <div className="role-mode-buttons">
              <button
                className="role-launch-btn primary-btn"
                onClick={() => onSelectRole('facility', 'map')}
              >
                🗺️ Enter Map Mode
              </button>
              <button
                className="role-launch-btn secondary-btn"
                onClick={() => onSelectRole('facility', 'type')}
              >
                ⌨️ Enter Type Mode
              </button>
            </div>
          </div>

          {/* Role Option 2: EV Rider */}
          <div className="role-card rider-role card">
            <div className="role-badge blue">DRIVER & OWNER</div>
            <h2>EV Rider</h2>
            <p className="role-desc">
              For current or prospective EV drivers. Checks whether owning an EV in your county is practical, maps local public charging stations, and lets you evaluate any address or point for nearby charging access.
            </p>
            <div className="role-features">
              <span>DOE AFDC charging station map</span>
              <span>County EV feasibility verdict</span>
              <span>Point & address charger search</span>
              <span>Mireye physical location data</span>
            </div>
            <div className="role-mode-buttons">
              <button
                className="role-launch-btn primary-btn"
                onClick={() => onSelectRole('rider', 'map')}
              >
                🗺️ Enter Map Mode
              </button>
              <button
                className="role-launch-btn secondary-btn"
                onClick={() => onSelectRole('rider', 'type')}
              >
                ⌨️ Enter Type Mode
              </button>
            </div>
          </div>
        </div>

        <div className="landing-sources" style={{ textAlign: 'center', marginTop: '2rem' }}>
          Powered by DOE Alternative Fuels Data Center &middot; Mireye API &middot; US Census Bureau &middot; State DMV Records
        </div>
      </div>
    </div>
  );
}
