// SalesCalculatorFragment.kt
package cl.friendlypos.mypos.ui.sales

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import cl.friendlypos.mypos.R
import cl.friendlypos.mypos.databinding.FragmentSalesCalcBinding

class SalesCalculatorFragment : Fragment() {

    private var _binding: FragmentSalesCalcBinding? = null
    private val binding get() = _binding!!
    private lateinit var viewModel: SalesCalculatorViewModel

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        viewModel = ViewModelProvider(this).get(SalesCalculatorViewModel::class.java)
        _binding = FragmentSalesCalcBinding.inflate(inflater, container, false)

        setupNumericPad()
        setupObservers()

        return binding.root
    }

    private fun setupNumericPad() {
        // Set up number buttons
        binding.btn0.setOnClickListener { viewModel.appendDigit("0") }
        binding.btn1.setOnClickListener { viewModel.appendDigit("1") }
        binding.btn2.setOnClickListener { viewModel.appendDigit("2") }
        binding.btn3.setOnClickListener { viewModel.appendDigit("3") }
        binding.btn4.setOnClickListener { viewModel.appendDigit("4") }
        binding.btn5.setOnClickListener { viewModel.appendDigit("5") }
        binding.btn6.setOnClickListener { viewModel.appendDigit("6") }
        binding.btn7.setOnClickListener { viewModel.appendDigit("7") }
        binding.btn8.setOnClickListener { viewModel.appendDigit("8") }
        binding.btn9.setOnClickListener { viewModel.appendDigit("9") }
        binding.btnDot.setOnClickListener { viewModel.appendDigit(",") }

        // Function buttons
        binding.btnClear.setOnClickListener { viewModel.clearEntry() }
        binding.btnDelete.setOnClickListener { viewModel.deleteLastDigit() }
        binding.btnAdd.setOnClickListener { viewModel.addItemToSale() }

        // Payment button
        binding.btnPay.setOnClickListener { viewModel.processSale() }
    }

    private fun setupObservers() {
        viewModel.currentAmount.observe(viewLifecycleOwner) { amount ->
            binding.tvAmount.text = "$$amount"
        }

        viewModel.totalAmount.observe(viewLifecycleOwner) { total ->
            binding.tvTotalAmount.text = "$$total"
        }

        viewModel.currentItemName.observe(viewLifecycleOwner) { name ->
            binding.tvItemName.text = name
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}