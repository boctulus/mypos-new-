package cl.friendlypos.mypos

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.os.Build
import android.content.Intent
import android.util.Log

import androidx.appcompat.app.AppCompatActivity
import androidx.navigation.findNavController
import androidx.navigation.ui.AppBarConfiguration
import androidx.navigation.ui.setupActionBarWithNavController
import androidx.navigation.ui.setupWithNavController
import androidx.coordinatorlayout.widget.CoordinatorLayout

import com.google.android.material.bottomnavigation.BottomNavigationView

import cl.friendlypos.mypos.databinding.ActivityMainBinding
import cl.friendlypos.mypos.utils.SystemUtils
import cl.friendlypos.mypos.utils.TopSnackbar

//import com.zcs.sdk.DriverManager;
//import com.zcs.sdk.Sys;

class MainActivity : AppCompatActivity()
{
    private lateinit var binding: ActivityMainBinding
    private lateinit var sharedPreferences: SharedPreferences
    private lateinit var coordinatorLayout: CoordinatorLayout

//    private lateinit var mDriverManager: DriverManager
//    private lateinit var mSys: Sys

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Log.d("DeviceCheck", if (SystemUtils.isEmulator()) "Emulador" else "Real Android")


//        mDriverManager = DriverManager.getInstance();
//        mSys = mDriverManager.getBaseSysDevice();
//        initSdk();

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        coordinatorLayout = findViewById(R.id.coordinator_layout)

        // Para mostrar un Snackbar
        // TopSnackbar.showInfo(coordinatorLayout, "Bienvenido a FriendlyPOS")

        val navView: BottomNavigationView = binding.navView

        val navController = findNavController(R.id.nav_host_fragment_activity_main)
        // Configurar los IDs de menú como destinos de nivel superior
        // Asegúrate de actualizar estos IDs para que coincidan con tu bottom_nav_menu.xml
        val appBarConfiguration = AppBarConfiguration(
            setOf(
                R.id.navigation_home // Solo Home es un destino de nivel superior
            )
        )
        setupActionBarWithNavController(navController, appBarConfiguration)
        navView.setupWithNavController(navController)

        // Configurar acción especial para el botón Home (central)
        navView.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.navigation_home -> {
                    // Asegurarse de que se navega al fragmento Home incluso si ya está seleccionado
                    navController.navigate(R.id.navigation_home)
                    true
                }
                else -> {
                    // Comportamiento normal para otros elementos
                    navController.navigate(item.itemId)
                    true
                }
            }
        }

        // Configurar credenciales de acceso (SharedPreferences)
        sharedPreferences = getSharedPreferences("AppPrefs", Context.MODE_PRIVATE)
    }

    private fun initSdk() {
//        val status = mSys.sdkInit();

//        if(status != SdkResult.SDK_OK) {
//            mSys.sysPowerOn();
//            try {
//                Thread.sleep(1000);
//            } catch (InterruptedException e) {
//                e.printStackTrace();
//            }
//            status = mSys.sdkInit();
//        }
//        if(status != SdkResult.SDK_OK) {
//            //init failed.
//        }
//        mSys.showDetailLog(true);
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        // Inflar el menú superior (tres puntos)
        menuInflater.inflate(R.menu.top_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_settings -> {
                Log.d("POS", "Configuración seleccionada")
                // Implementar acción para abrir configuración
                true
            }
            R.id.action_reports -> {
                Log.d("POS", "Reportes seleccionados")
                // Implementar acción para mostrar reportes
                true
            }
            R.id.action_user -> {
                Log.d("POS", "Gestión de usuario seleccionada")
                // Implementar acción para gestión de usuario
                true
            }
            R.id.action_scanner_testing -> {
                Log.d("POS", "Iniciando prueba de escáner...")
                // Crea un Intent para iniciar ScannerActivity
                val intent = Intent(this, ScannerActivity::class.java)
                startActivity(intent)
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun setupNavigation() {
        val navView: BottomNavigationView = binding.navView
        val navController = findNavController(R.id.nav_host_fragment_activity_main)

        val appBarConfiguration = AppBarConfiguration(
            setOf(
                // R.id.navigation_dashboard,
                R.id.navigation_home,
                R.id.navigation_notifications
            )
        )

        setupActionBarWithNavController(navController, appBarConfiguration)
        navView.setupWithNavController(navController)
    }

    /*
        Habilita boton de retroceso en el ActionBar
    */
    override fun onSupportNavigateUp(): Boolean {
        val navController = findNavController(R.id.nav_host_fragment_activity_main)
        return navController.navigateUp() || super.onSupportNavigateUp()
    }
}